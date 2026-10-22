import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const source = await readFile(new URL("../assets/quote-font.bdf.gz", import.meta.url));
const checksum = createHash("sha256").update(source).digest("hex");
if (checksum !== "3a0ddf814f89990e84e229a69efdd5f5d7b15e07302865add8463ff7f6965acc") {
  throw new Error("Bundled font checksum does not match.");
}
const output = Buffer.alloc(65536 * 33);
const text = gunzipSync(source).toString("utf8");
let count = 0;
for (const glyph of text.split("STARTCHAR ").slice(1)) {
  const codepoint = Number(glyph.match(/\nENCODING (\d+)/)?.[1]);
  const bounds = glyph.match(/\nBBX (\d+) (\d+) (-?\d+) (-?\d+)/);
  const bitmap = glyph.match(/\nBITMAP[ \t]*\n([\s\S]+?)\nENDCHAR/);
  if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > 65535 || !bounds || !bitmap) continue;
  const width = Number(bounds[1]);
  const height = Number(bounds[2]);
  if ((width !== 8 && width !== 16) || height !== 16 || Number(bounds[3]) !== 0 || Number(bounds[4]) !== -2) {
    throw new Error(`Unsupported glyph geometry at U+${codepoint.toString(16)}`);
  }
  const rows = bitmap[1].trim().split("\n");
  if (rows.length !== 16) throw new Error("Invalid bitmap height");
  const offset = codepoint * 33;
  output[offset] = width;
  for (let row = 0; row < 16; row++) {
    output.writeUInt16BE(Number.parseInt(rows[row], 16) << (16 - width), offset + 1 + row * 2);
  }
  count++;
}
if (count < 50000) throw new Error("Font is unexpectedly incomplete");
await writeFile(new URL("../src/font.bin", import.meta.url), output);
console.log(`Built ${count} glyphs (${output.length} bytes).`);
