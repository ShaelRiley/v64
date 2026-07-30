import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCandidate4Tranche,
  CANDIDATE_4_ASSET_ID
} from "../tools/build-candidate-4-tranche.mjs";

const source = JSON.parse(readFileSync(
  new URL("../bench/corpus/human-raster-tranche-2-manifest.json", import.meta.url),
  "utf8"
));

test("Candidate-4 tranche preserves every matched lane except palette identity", () => {
  const before = structuredClone(source);
  const manifest = buildCandidate4Tranche(source);
  assert.deepEqual(source, before, "builder must not mutate tranche 2");
  assert.equal(manifest.id, "V64-HUMAN-RASTER-TRANCHE-3");
  assert.equal(manifest.entries.length, 14);
  assert.equal(
    manifest.entries.filter((entry) => entry.paletteAsset === CANDIDATE_4_ASSET_ID).length,
    7
  );
  assert.deepEqual(
    [...new Set(manifest.entries.map((entry) => entry.paletteAsset))].sort(),
    ["V64-P256-CANDIDATE-1", CANDIDATE_4_ASSET_ID].sort()
  );

  const groups = new Map();
  for (const entry of manifest.entries) {
    const group = entry.review.group;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }
  assert.equal(groups.size, 7);
  for (const [group, entries] of groups) {
    assert.equal(entries.length, 2, `${group} must remain a matched pair`);
    const baseline = entries.find((entry) => entry.paletteAsset === "V64-P256-CANDIDATE-1");
    const candidate4 = entries.find((entry) => entry.paletteAsset === CANDIDATE_4_ASSET_ID);
    assert.ok(baseline && candidate4);
    assert.equal(baseline.source.sha256, candidate4.source.sha256);
    assert.deepEqual(baseline.grid, candidate4.grid);
    assert.equal(baseline.cadence, candidate4.cadence);
    assert.equal(baseline.maximumSeconds, candidate4.maximumSeconds);
    assert.equal(baseline.temporalStability, candidate4.temporalStability);
    assert.match(candidate4.id, /-hyperreal-4$/);
  }
});
