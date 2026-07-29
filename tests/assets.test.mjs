import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GLYPH_BYTES, GLYPH_HASH, GLYPH_MASKS, GLYPH_META,
  MASTER_PALETTE, MASTER_PALETTE_BYTES, PALETTE_HASH, PALETTE_META
} from "../prototype/js/assets.mjs";
import { PALETTE_DEPTHS, bitsPerIndex } from "../prototype/js/constants.mjs";
import { makeGlyphAtlas, renderCells } from "../prototype/js/video64.mjs";

test("canonical Video64-v1 asset is exactly 64 named 8x16 masks", () => {
  assert.equal(GLYPH_META.id, "V64-GLYPHS-VIDEO64-1");
  assert.equal(GLYPH_META.names.length, 64);
  assert.equal(GLYPH_MASKS.length, 64);
  assert.ok(GLYPH_MASKS.every((mask) => mask.length === 16));
  assert.equal(GLYPH_BYTES.length, 1024);
  assert.equal(GLYPH_HASH.toString("hex"), "9a75062711504dc9b2d473cdc261e0a8e34ff349ed9a8e1dc293467e9215da2b");
  assert.equal(createHash("sha256").update(GLYPH_BYTES).digest("hex"), GLYPH_META.sha256);
  assert.deepEqual(GLYPH_META.names.slice(0, 8), [
    "Void", "Center Pin", "Vertical Seed", "Horizontal Seed",
    "Small Disk", "Ring", "Mid Disk", "Full Block"
  ]);
});

test("all canonical glyphs render deterministically", () => {
  const cells = new Uint8Array(64 * 3);
  for (let glyph = 0; glyph < 64; glyph += 1) {
    cells[glyph * 3] = glyph;
    cells[glyph * 3 + 1] = 1;
    cells[glyph * 3 + 2] = 0;
  }
  const first = renderCells(cells, 8, 8, 2);
  const second = makeGlyphAtlas(1);
  assert.deepEqual(first.rgba, second.rgba);
  assert.equal(first.width, 64);
  assert.equal(first.height, 128);
});

test("master palette candidate is reproducible, ordered, and supports every depth prefix", () => {
  assert.equal(PALETTE_META.id, "V64-P256-CANDIDATE-1");
  assert.equal(MASTER_PALETTE.length, 256);
  assert.equal(MASTER_PALETTE_BYTES.length, 768);
  assert.equal(PALETTE_HASH.toString("hex"), "f2b6ae132bc269e17e66378184e66f2dfdf0a079ff0281fa69858144252fefb2");
  assert.equal(createHash("sha256").update(MASTER_PALETTE_BYTES).digest("hex"), PALETTE_META.sha256);
  for (const depth of PALETTE_DEPTHS) {
    assert.equal(MASTER_PALETTE.slice(0, depth).length, depth);
    assert.ok(bitsPerIndex(depth) >= 1 && bitsPerIndex(depth) <= 8);
  }
  assert.deepEqual(MASTER_PALETTE[0], [0, 0, 0]);
  assert.deepEqual(MASTER_PALETTE[1], [255, 255, 255]);
});

test("asset JSON and binary declarations agree", () => {
  const disk = readFileSync(new URL("../assets/glyphs/video64-v1.bin", import.meta.url));
  assert.deepEqual(disk, GLYPH_BYTES);
});
