import { renderQuote } from "./render";

const encoder = new TextEncoder();
const MAX_REQUEST = 64 * 1024;
const MAX_AVATAR = 64 * 1024;

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

interface DiscordMessage {
  content: string;
  author: DiscordUser;
  member?: { nick?: string | null };
}

interface Interaction {
  type: number;
  application_id: string;
  token: string;
  data?: {
    type: number;
    name: string;
    target_id?: string;
    resolved?: { messages?: Record<string, DiscordMessage> };
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function reply(content: string): Response {
  return json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
}

async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body?.getReader();
  if (!reader) throw new HttpError(400, "Missing body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > limit) { await reader.cancel(); throw new HttpError(413, "Request too large"); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new HttpError(401, "Invalid signature");
  return Uint8Array.from(value.match(/../g)!, (byte) => Number.parseInt(byte, 16));
}

async function fetchAvatar(user: DiscordUser): Promise<Uint8Array | undefined> {
  if (!/^\d+$/.test(user.id) || !user.avatar || !/^(?:a_)?[a-f0-9]+$/.test(user.avatar)) return undefined;
  try {
    const response = await fetch(`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`, {
      signal: AbortSignal.timeout(3000), redirect: "manual"
    });
    if (!response.ok || Number(response.headers.get("Content-Length")) > MAX_AVATAR) {
      await response.body?.cancel();
      return undefined;
    }
    return await readLimited(response.body, MAX_AVATAR);
  } catch { return undefined; }
}

function webhookUrl(interaction: Interaction): string {
  return `https://discord.com/api/v10/webhooks/${interaction.application_id}/${encodeURIComponent(interaction.token)}/messages/@original`;
}

async function editError(interaction: Interaction, content: string): Promise<void> {
  const response = await fetch(webhookUrl(interaction), {
    method: "PATCH", signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
  });
  await response.body?.cancel();
}

async function generateQuote(interaction: Interaction, message: DiscordMessage): Promise<void> {
  try {
    const name = message.member?.nick || message.author.global_name || message.author.username;
    const png = await renderQuote(message.content.trim(), name, await fetchAvatar(message.author));
    const form = new FormData();
    form.set("payload_json", JSON.stringify({
      allowed_mentions: { parse: [] },
      attachments: [{ id: 0, filename: "quote.png", description: `${message.content.trim()} — ${name}` }]
    }));
    form.set("files[0]", new Blob([png], { type: "image/png" }), "quote.png");
    const response = await fetch(webhookUrl(interaction), {
      method: "PATCH", body: form, signal: AbortSignal.timeout(8000)
    });
    await response.body?.cancel();
    if (!response.ok) {
      await editError(interaction, response.status === 429 ? "Discordの制限中です。少し待ってから再実行してください。" : "画像を投稿できませんでした。Discordの権限を確認して再実行してください。");
    }
  } catch (error) {
    const content = error instanceof Error && error.message.startsWith("改行が多すぎて")
      ? error.message : "画像を作成できませんでした。時間を置いて再実行してください。";
    try { await editError(interaction, content); } catch { }
  }
}

async function interactionResponse(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
  const signature = request.headers.get("X-Signature-Ed25519") ?? "";
  const timestamp = request.headers.get("X-Signature-Timestamp") ?? "";
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || signature.length !== 128) {
    throw new HttpError(401, "Invalid signature");
  }
  if (Number(request.headers.get("Content-Length")) > MAX_REQUEST) throw new HttpError(413, "Request too large");
  const body = await readLimited(request.body, MAX_REQUEST);
  const signed = new Uint8Array(timestamp.length + body.length);
  signed.set(encoder.encode(timestamp)); signed.set(body, timestamp.length);
  const key = await crypto.subtle.importKey("raw", fromHex(env.DISCORD_PUBLIC_KEY), "Ed25519", false, ["verify"]);
  if (!await crypto.subtle.verify("Ed25519", key, fromHex(signature), signed)) throw new HttpError(401, "Invalid signature");
  const interaction = JSON.parse(new TextDecoder().decode(body)) as Interaction;
  if (interaction.application_id !== env.DISCORD_APPLICATION_ID) throw new HttpError(401, "Invalid application");
  if (interaction.type === 1) return json({ type: 1 });
  if (interaction.type !== 2 || interaction.data?.type !== 3 || interaction.data.name !== "makeitquote") return reply("メッセージのアプリメニューから makeitquote を選んでください。");
  const message = interaction.data.resolved?.messages?.[interaction.data.target_id ?? ""];
  if (!message?.content.trim()) return reply("本文のあるメッセージを選んでください。添付画像や埋め込みだけのメッセージは引用できません。");
  if (Array.from(message.content.trim()).length > 240) return reply("引用は240文字までです。短いメッセージを選んでください。");
  context.waitUntil(generateQuote(interaction, message));
  return json({ type: 5, data: { flags: 0 } });
}

export default {
  async fetch(request, env, context): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/" && request.method === "GET") return json({ name: "makeitquote", stateless: true });
      if (url.pathname !== "/interactions") return json({ error: "Not found" }, 404);
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return await interactionResponse(request, env, context);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      if (error instanceof SyntaxError) return json({ error: "Invalid JSON" }, 400);
      return json({ error: "Internal error" }, 500);
    }
  }
} satisfies ExportedHandler<Env>;
