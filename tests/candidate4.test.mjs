import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HYPERREAL_ANCHORS,
  HYPERREAL_CANDIDATE_4_PREFIX,
  generateHyperRealCandidate4Palette,
  paletteHash
} from "../tools/hyperreal-palette-generator.mjs";
import {
  PALETTE_ASSET_IDS,
  paletteAssetFromId
} from "../prototype/js/palette-registry.mjs";

test("Hyper Real candidate 4 restores a light-neutral prefix rung", () => {
  const first = generateHyperRealCandidate4Palette();
  const second = generateHyperRealCandidate4Palette();
  assert.deepEqual(first, second);
  assert.equal(first.length, 256);
  assert.deepEqual(first.slice(0, HYPERREAL_ANCHORS.length), HYPERREAL_ANCHORS);
  assert.deepEqual(first.slice(0, 16), HYPERREAL_CANDIDATE_4_PREFIX);
  assert.deepEqual(HYPERREAL_CANDIDATE_4_PREFIX.slice(12), [
    [16, 32, 72],
    [0, 92, 96],
    [224, 224, 224],
    [112, 112, 112]
  ]);
  assert.equal(new Set(first.map((color) => color.join(","))).size, 256);
  assert.equal(
    paletteHash(first),
    "f683d64d46f95d5cd49638302eb18aeee7ac1684b2ad22b61ff7b4984c3ffd37"
  );

  const metadata = JSON.parse(readFileSync(
    new URL("../assets/palettes/v64-p256-hyperreal-candidate-4.json", import.meta.url),
    "utf8"
  ));
  assert.equal(metadata.id, "V64-P256-HYPERREAL-CANDIDATE-4");
  assert.equal(metadata.sha256, paletteHash(first));
  assert.equal(
    metadata.prefix.sha256,
    "1e8997b6c6abb748df607bfe3156898a4fd6df547554b31cb150ce31c410bfd6"
  );
  assert.deepEqual(metadata.colors, first);

  assert.ok(PALETTE_ASSET_IDS.includes(metadata.id));
  const registered = paletteAssetFromId(metadata.id);
  assert.equal(registered.sha256, metadata.sha256);
  assert.deepEqual(registered.colors.slice(0, 16), HYPERREAL_CANDIDATE_4_PREFIX);
});
