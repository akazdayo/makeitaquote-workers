import { convertIndexedToRgb, decode } from "fast-png";
import fontData from "./font.bin";

export const WIDTH = 640;
export const HEIGHT = 360;
const font = new Uint8Array(fontData);
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function glyphOffset(character: string): number {
  const codepoint = character.codePointAt(0)!;
  return (codepoint <= 65535 && font[codepoint * 33] ? codepoint : 0x25a1) * 33;
}

function textWidth(text: string, scale: number): number {
  let width = 0;
  for (const character of text) width += (font[glyphOffset(character)]! + 1) * scale;
  return Math.max(0, width - scale);
}

function wrap(text: string, scale: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    let used = 0;
    for (const character of paragraph) {
      const advance = (font[glyphOffset(character)]! + 1) * scale;
      if (line && used + advance > width) { lines.push(line); line = ""; used = 0; }
      line += character;
      used += advance;
    }
    lines.push(line);
  }
  return lines;
}

function drawText(pixels: Uint8Array, text: string, left: number, top: number, scale: number, shade: number): void {
  let cursor = left;
  for (const character of text) {
    const offset = glyphOffset(character);
    const width = font[offset]!;
    for (let row = 0; row < 16; row++) {
      const bits = (font[offset + 1 + row * 2]! << 8) | font[offset + 2 + row * 2]!;
      for (let column = 0; column < width; column++) {
        if (!(bits & (0x8000 >>> column))) continue;
        for (let vertical = 0; vertical < scale; vertical++) {
          const position = (top + row * scale + vertical) * WIDTH + cursor + column * scale;
          pixels.fill(shade, position, position + scale);
        }
      }
    }
    cursor += (width + 1) * scale;
  }
}

function centered(pixels: Uint8Array, text: string, top: number, scale: number, shade: number): void {
  drawText(pixels, text, 300 + Math.floor((320 - textWidth(text, scale)) / 2), top, scale, shade);
}

function shortName(name: string): string {
  let result = "";
  for (const character of name.replace(/\s+/g, " ")) {
    if (textWidth(`— ${result}${character}…`, 1) > 310) return `${result}…`;
    result += character;
  }
  return result;
}

function avatarBackground(pixels: Uint8Array, bytes: Uint8Array): boolean {
  try {
    if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return false;
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (header.getUint32(16) > 64 || header.getUint32(20) > 64) return false;
    let image = decode(bytes);
    if (image.palette) image = { ...image, data: convertIndexedToRgb(image), channels: image.palette[0]!.length, depth: 8, palette: undefined };
    if (image.depth !== 8 || image.width < 1 || image.height < 1) return false;
    const { data, width, height, channels } = image;
    const factors = Uint16Array.from({ length: 330 }, (_, column) => Math.min(256, Math.max(0, Math.round((330 - column) * 256 / 180))));
    const columns = Uint16Array.from({ length: 330 }, (_, column) => Math.min(width - 1, Math.floor((column + 15) * width / 360)) * channels);
    for (let row = 0; row < HEIGHT; row++) {
      const sourceRow = Math.min(height - 1, Math.floor(row * height / HEIGHT)) * width * channels;
      for (let column = 0; column < 330; column++) {
        const source = sourceRow + columns[column]!;
        const gray = channels < 3 ? data[source]! : (data[source]! * 77 + data[source + 1]! * 150 + data[source + 2]! * 29) >>> 8;
        const alpha = channels === 2 || channels === 4 ? data[source + channels - 1]! : 255;
        const factor = (factors[column]! * alpha) >>> 8;
        pixels[row * WIDTH + column] = 8 + (((gray - 8) * factor) >> 8);
      }
    }
    return true;
  } catch { return false; }
}

function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(data.length + 12);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set(encoder.encode(type), 4);
  output.set(data, 8);
  view.setUint32(output.length - 4, crc(output.subarray(4, output.length - 4)));
  return output;
}

async function encodePng(pixels: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const scanlines = new Uint8Array((WIDTH + 1) * HEIGHT);
  for (let row = 0; row < HEIGHT; row++) scanlines.set(pixels.subarray(row * WIDTH, (row + 1) * WIDTH), row * (WIDTH + 1) + 1);
  const compressed = new Uint8Array(await new Response(
    new Response(scanlines).body!.pipeThrough(new CompressionStream("deflate"))
  ).arrayBuffer());
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, WIDTH); headerView.setUint32(4, HEIGHT);
  header[8] = 8;
  const chunks = [chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())];
  const output = new Uint8Array(8 + chunks.reduce((length, part) => length + part.length, 0));
  output.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  for (const part of chunks) { output.set(part, offset); offset += part.length; }
  return output;
}

export async function renderQuote(text: string, name: string, avatar?: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  let scale = 2;
  let lines = wrap(normalized, scale, 320);
  if (lines.length * 18 * scale > 270) { scale = 1; lines = wrap(normalized, scale, 320); }
  if (lines.length * 18 * scale > 270) throw new Error("改行が多すぎて画像に収まりません。短いメッセージで試してください。");
  const pixels = new Uint8Array(WIDTH * HEIGHT).fill(8);
  if (!avatar || !avatarBackground(pixels, avatar)) {
    for (let row = 0; row < HEIGHT; row++) {
      for (let column = 0; column < 280; column++) pixels[row * WIDTH + column] = 8 + Math.floor((280 - column) * 55 / 280);
    }
    drawText(pixels, Array.from(name)[0] || "?", 105, 148, 4, 180);
  }
  const top = 34 + Math.floor((270 - lines.length * 18 * scale) / 2);
  centered(pixels, "“", Math.max(0, top - 32), 2, 205);
  lines.forEach((line, index) => centered(pixels, line, top + index * 18 * scale, scale, 245));
  centered(pixels, `— ${shortName(name)}`, Math.min(316, top + lines.length * 18 * scale + 20), 1, 170);
  centered(pixels, "MAKE IT A QUOTE", 342, 1, 90);
  return encodePng(pixels);
}
