#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writePaletteAssets } from "./palette-generator.mjs";

const require = createRequire(import.meta.url);
const sourcePath = resolve(process.argv[2] || "../ansi-tube-source/core.js");
const outputRoot = resolve(new URL("../assets", import.meta.url).pathname);
const core = require(sourcePath);
const names = core.VIDEO_GLYPH_NAMES;
const masks = core.VIDEO_GLYPH_MASKS;

if (!Array.isArray(names) || names.length !== 64) throw new Error(`Expected 64 glyph names; found ${names?.length}`);
if (!Array.isArray(masks) || masks.length !== 64 || masks.some((mask) => !Array.isArray(mask) || mask.length !== 16)) {
  throw new Error("Expected exactly 64 masks of 16 rows");
}
for (const [glyph, mask] of masks.entries()) {
  for (const [row, byte] of mask.entries()) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error(`Invalid byte at glyph ${glyph}, row ${row}`);
  }
}

const bytes = Buffer.from(masks.flat());
if (bytes.length !== 1024) throw new Error(`Expected 1,024 mask bytes; found ${bytes.length}`);
const hash = createHash("sha256").update(bytes).digest("hex");
const glyphDirectory = resolve(outputRoot, "glyphs");
mkdirSync(glyphDirectory, { recursive: true });
writeFileSync(resolve(glyphDirectory, "video64-v1.bin"), bytes);
writeFileSync(resolve(glyphDirectory, "video64-v1-names.json"), `${JSON.stringify(names, null, 2)}\n`);
writeFileSync(resolve(glyphDirectory, "video64-v1.json"), `${JSON.stringify({
  id: "V64-GLYPHS-VIDEO64-1",
  provenance: {
    project: "ANSI Tube",
    author: "Shael Riley",
    sourceFile: basename(sourcePath)
  },
  width: 8,
  height: 16,
  glyphCount: 64,
  byteOrder: "glyph-major, row-major, MSB-left",
  sha256: hash,
  names,
  masks
}, null, 2)}\n`);

const palette = writePaletteAssets(resolve(outputRoot, "palettes"));
console.log(JSON.stringify({
  glyphs: { count: names.length, bytes: bytes.length, sha256: hash },
  palette: { count: palette.palette.length, bytes: palette.bytes, sha256: palette.hash }
}, null, 2));
