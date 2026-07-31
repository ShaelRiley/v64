import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GLYPH_BYTES } from "../prototype/js/assets.mjs";
import { paletteAssetFromId } from "../prototype/js/palette-registry.mjs";
import { renderCells } from "../prototype/js/video64.mjs";

const COLUMNS = 8;
const ROWS = 8;
const PALETTE_DEPTH = 256;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function rendererConformanceCells() {
  const cells = Buffer.alloc(64 * 3);
  for (let glyph = 0; glyph < 64; glyph += 1) {
    cells[glyph * 3] = glyph;
    cells[glyph * 3 + 1] = (glyph * 37 + 3) & 255;
    cells[glyph * 3 + 2] = (glyph * 91 + 17) & 255;
  }
  return cells;
}

export function rendererConformancePalette() {
  const bytes = Buffer.alloc(256 * 3);
  for (let index = 0; index < 256; index += 1) {
    bytes[index * 3] = index;
    bytes[index * 3 + 1] = (index * 73 + 19) & 255;
    bytes[index * 3 + 2] = (index * 151 + 47) & 255;
  }
  return bytes;
}

function colorsFromBytes(bytes) {
  return Object.freeze(Array.from({ length: 256 }, (_, index) =>
    Object.freeze([...bytes.subarray(index * 3, index * 3 + 3)])));
}

export function buildRendererGolden(outputDirectory) {
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });

  const cells = rendererConformanceCells();
  const syntheticPalette = rendererConformancePalette();
  const normativePalette = paletteAssetFromId("V64-P256-1");
  const normative = renderCells(
    cells,
    COLUMNS,
    ROWS,
    PALETTE_DEPTH,
    normativePalette.colors
  );
  const synthetic = renderCells(
    cells,
    COLUMNS,
    ROWS,
    PALETTE_DEPTH,
    colorsFromBytes(syntheticPalette)
  );

  writeFileSync(resolve(output, "cells.bin"), cells);
  writeFileSync(resolve(output, "video64-v1.bin"), GLYPH_BYTES);
  writeFileSync(resolve(output, "v64-p256-1.rgb"), normativePalette.bytes);
  writeFileSync(resolve(output, "synthetic-p256.rgb"), syntheticPalette);
  writeFileSync(resolve(output, "javascript-normative-atlas.rgba"), normative.rgba);
  writeFileSync(resolve(output, "javascript-synthetic-atlas.rgba"), synthetic.rgba);

  const manifest = {
    format: "V64-RENDERER-GOLDEN-1",
    columns: COLUMNS,
    rows: ROWS,
    width: normative.width,
    height: normative.height,
    paletteDepth: PALETTE_DEPTH,
    cellBytes: cells.length,
    rasterBytes: normative.rgba.length,
    glyphSha256: sha256(GLYPH_BYTES),
    normativePaletteSha256: sha256(normativePalette.bytes),
    syntheticPaletteSha256: sha256(syntheticPalette),
    normativeRgbaSha256: sha256(normative.rgba),
    syntheticRgbaSha256: sha256(synthetic.rgba)
  };
  writeFileSync(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] || "target/renderer-golden";
  console.log(JSON.stringify(buildRendererGolden(output), null, 2));
}
