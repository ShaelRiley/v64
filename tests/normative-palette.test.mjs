import assert from "node:assert/strict";
import test from "node:test";
import {
  PALETTE_ASSET_IDS,
  paletteAssetFromId
} from "../prototype/js/palette-registry.mjs";

const HASH = "c03d23141eb33b80d79d1a7f3167eeb18ccf1f4f0c0f81572f269abd51317105";
const PREFIX_HASH = "e8d7b7de275b79acb403d17a97c4e7ef72ca16600a8f4f3ebdcba86099ce41cf";

test("V64-P256-1 is the normative executable default", () => {
  assert.equal(PALETTE_ASSET_IDS[0], "V64-P256-1");
  const defaultAsset = paletteAssetFromId();
  const normative = paletteAssetFromId("V64-P256-1");
  const candidate6a = paletteAssetFromId("V64-P256-HYPERREAL-CANDIDATE-6A");
  assert.equal(defaultAsset.id, "V64-P256-1");
  assert.equal(normative.metadata.status, "normative");
  assert.equal(normative.metadata.normativeVersion, 1);
  assert.equal(normative.metadata.sourceCandidate, candidate6a.id);
  assert.equal(normative.sha256, HASH);
  assert.equal(normative.metadata.prefix.sha256, PREFIX_HASH);
  assert.deepEqual(normative.bytes, candidate6a.bytes);
  assert.deepEqual(normative.colors, candidate6a.colors);
});

test("normative prefix fixes dark chroma and three neutral rungs", () => {
  const prefix = paletteAssetFromId().colors.slice(0, 16);
  assert.deepEqual(prefix[12], [4, 77, 90]);
  assert.deepEqual(prefix.slice(13), [
    [32, 32, 32],
    [224, 224, 224],
    [112, 112, 112]
  ]);
});
