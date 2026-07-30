import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCandidate4Tranche } from "../tools/build-candidate-4-tranche.mjs";
import {
  buildCandidate5Ablation,
  CANDIDATE_5A_ASSET_ID,
  CANDIDATE_5B_ASSET_ID
} from "../tools/build-candidate-5-ablation.mjs";

const tranche2 = JSON.parse(readFileSync(
  new URL("../bench/corpus/human-raster-tranche-2-manifest.json", import.meta.url),
  "utf8"
));
const source = buildCandidate4Tranche(tranche2);

test("Candidate-5 ablation preserves three matched four-way groups", () => {
  const before = structuredClone(source);
  const manifest = buildCandidate5Ablation(source);
  assert.deepEqual(source, before);
  assert.equal(manifest.id, "V64-HUMAN-RASTER-TRANCHE-4");
  assert.equal(manifest.entries.length, 12);

  const expectedPalettes = new Set([
    "V64-P256-CANDIDATE-1",
    "V64-P256-HYPERREAL-CANDIDATE-4",
    CANDIDATE_5A_ASSET_ID,
    CANDIDATE_5B_ASSET_ID
  ]);
  const groups = new Map();
  for (const entry of manifest.entries) {
    assert.ok(expectedPalettes.has(entry.paletteAsset));
    if (!groups.has(entry.review.group)) groups.set(entry.review.group, []);
    groups.get(entry.review.group).push(entry);
  }
  assert.deepEqual([...groups.keys()], ["depth-40", "monochrome-40", "screen-40"]);
  for (const [group, lanes] of groups) {
    assert.equal(lanes.length, 4, `${group} must have four palette variants`);
    assert.deepEqual(new Set(lanes.map((entry) => entry.paletteAsset)), expectedPalettes);
    assert.equal(new Set(lanes.map((entry) => entry.source.sha256)).size, 1);
    assert.equal(new Set(lanes.map((entry) => JSON.stringify(entry.grid))).size, 1);
    assert.equal(new Set(lanes.map((entry) => entry.cadence)).size, 1);
    assert.equal(new Set(lanes.map((entry) => entry.maximumSeconds)).size, 1);
    assert.equal(new Set(lanes.map((entry) => entry.temporalStability)).size, 1);
  }
});
