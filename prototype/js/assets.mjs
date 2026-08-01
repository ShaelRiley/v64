import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const glyphBytes = readFileSync(new URL("../../assets/glyphs/video64-v1.bin", import.meta.url));
const glyphMeta = JSON.parse(readFileSync(new URL("../../assets/glyphs/video64-v1.json", import.meta.url), "utf8"));
const paletteBytes = readFileSync(new URL("../../assets/palettes/v64-p256-1.rgb", import.meta.url));
const paletteMeta = JSON.parse(readFileSync(new URL("../../assets/palettes/v64-p256-1.json", import.meta.url), "utf8"));
const legacyPaletteMeta = JSON.parse(readFileSync(
  new URL("../../assets/palettes/v64-p256-candidate-1.json", import.meta.url), "utf8"
));

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

if (glyphBytes.length !== 1024 || glyphMeta.glyphCount !== 64 || glyphMeta.width !== 8 || glyphMeta.height !== 16) {
  throw new Error("Invalid bundled Video64-v1 glyph asset");
}
if (paletteBytes.length !== 768 ||
    (paletteMeta.colors ? paletteMeta.colors.length !== 256 : paletteMeta.generatedColors !== true)) {
  throw new Error("Invalid bundled normative V64 master palette");
}
if (sha256(glyphBytes) !== glyphMeta.sha256) throw new Error("Bundled Video64-v1 glyph hash mismatch");
if (sha256(paletteBytes) !== paletteMeta.sha256) throw new Error("Bundled V64 palette hash mismatch");

export const GLYPH_BYTES = Buffer.from(glyphBytes);
export const GLYPH_META = Object.freeze(glyphMeta);
export const GLYPH_MASKS = Object.freeze(Array.from({ length: 64 }, (_, index) =>
  Object.freeze([...glyphBytes.subarray(index * 16, index * 16 + 16)])));
export const MASTER_PALETTE_BYTES = Buffer.from(paletteBytes);
export const PALETTE_META = Object.freeze(paletteMeta);
export const MASTER_PALETTE = Object.freeze(Array.from({ length: 256 }, (_, index) =>
  Object.freeze([...paletteBytes.subarray(index * 3, index * 3 + 3)])));
export const GLYPH_HASH = Buffer.from(glyphMeta.sha256, "hex");
export const PALETTE_HASH = Buffer.from(paletteMeta.sha256, "hex");
export const LEGACY_PALETTE_HASH = Buffer.from(legacyPaletteMeta.sha256, "hex");
