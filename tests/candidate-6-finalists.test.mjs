import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCandidate4Tranche } from "../tools/build-candidate-4-tranche.mjs";
import { buildCandidate5Ablation } from "../tools/build-candidate-5-ablation.mjs";
import { buildCandidate6Finalists } from "../tools/build-candidate-6-finalists.mjs";

const tranche2 = JSON.parse(readFileSync(
  new URL("../bench/corpus/human-raster-tranche-2-manifest.json", import.meta.url),
  "utf8"
));
const tranche4 = buildCandidate5Ablation(buildCandidate4Tranche(tranche2));

const EXPECTED = new Set([
  "V64-P256-CANDIDATE-1",
  "V64-P256-HYPERREAL-CANDIDATE-5A",
  "V64-P256-HYPERREAL-CANDIDATE-5B",
  "V64-P256-HYPERREAL-CANDIDATE-6A",
  "V64-P256-HYPERREAL-CANDIDATE-6B",
  "V64-P256-HYPERREAL-CANDIDATE-6C"
]);

test("Candidate-6 tranche is three matched six-way groups", () => {
  const before = structuredClone(tranche4);
  const manifest = buildCandidate6Finalists(tranche4);
  assert.deepEqual(tranche4, before);
  assert.equal(manifest.id, "V64-HUMAN-RASTER-TRANCHE-5");
  assert.equal(manifest.entries.length, 18);

  const groups = new Map();
  for (const entry of manifest.entries) {
    if (!groups.has(entry.review.group)) groups.set(entry.review.group, []);
    groups.get(entry.review.group).push(entry);
  }
  assert.deepEqual([...groups.keys()], ["depth-40", "monochrome-40", "screen-40"]);
  for (const [group, lanes] of groups) {
    assert.equal(lanes.length, 6, `${group} must contain six palette variants`);
    assert.deepEqual(new Set(lanes.map((entry) => entry.paletteAsset)), EXPECTED);
    assert.equal(new Set(lanes.map((entry) => entry.source.sha256)).size, 1);
    assert.equal(new Set(lanes.map((entry) => JSON.stringify(entry.grid))).size, 1);
    assert.equal(new Set(lanes.map((entry) => entry.cadence)).size, 1);
    assert.equal(new Set(lanes.map((entry) => entry.maximumSeconds)).size, 1);
    assert.equal(new Set(lanes.map((entry) => entry.temporalStability)).size, 1);
  }
});
