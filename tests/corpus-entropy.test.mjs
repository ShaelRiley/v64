import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  generateCorpus, STRUCTURAL_CLASSES, validateCorpusManifest
} from "../prototype/js/corpus-fixtures.mjs";
import {
  benchmarkEntropyCorpus, deriveStaticByteCosts, ENTROPY_REPORT_VERSION
} from "../prototype/js/entropy-benchmark.mjs";

const manifest = JSON.parse(readFileSync(
  new URL("../bench/corpus/seed-manifest.json", import.meta.url),
  "utf8"
));

test("seed corpus has verified provenance and every required structural class", () => {
  const validated = validateCorpusManifest(manifest);
  assert.deepEqual(
    [...new Set(validated.entries.map((entry) => entry.structuralClass))].sort(),
    [...STRUCTURAL_CLASSES].sort()
  );
  assert.ok(validated.entries.every((entry) => entry.provenance.license === "CC0-1.0"));
  assert.throws(
    () => validateCorpusManifest({
      ...manifest,
      entries: manifest.entries.map((entry, index) =>
        index ? entry : { ...entry, provenance: { ...entry.provenance, license: "unknown" } }
      )
    }),
    /provenance/
  );
});

test("every seed fixture is deterministic and stays within declared bounds", () => {
  const first = generateCorpus(manifest);
  const second = generateCorpus(manifest);
  assert.equal(first.fixtures.length, STRUCTURAL_CLASSES.length);
  for (let fixtureIndex = 0; fixtureIndex < first.fixtures.length; fixtureIndex += 1) {
    const a = first.fixtures[fixtureIndex];
    const b = second.fixtures[fixtureIndex];
    assert.equal(a.frames.length, a.entry.frames);
    assert.equal(b.frames.length, a.frames.length);
    for (let frameIndex = 0; frameIndex < a.frames.length; frameIndex += 1) {
      assert.deepEqual(a.frames[frameIndex], b.frames[frameIndex]);
      assert.equal(
        a.frames[frameIndex].length,
        a.entry.grid.columns * a.entry.grid.rows * 3
      );
      for (let offset = 0; offset < a.frames[frameIndex].length; offset += 3) {
        assert.ok(a.frames[frameIndex][offset] < 64);
        assert.ok(a.frames[frameIndex][offset + 1] < a.entry.paletteDepth);
        assert.ok(a.frames[frameIndex][offset + 2] < a.entry.paletteDepth);
      }
    }
  }
});

test("static byte costs are finite, smoothed, and favor observed bytes", () => {
  const costs = deriveStaticByteCosts([Buffer.from([7, 7, 7, 8])]);
  assert.equal(costs.length, 256);
  assert.ok(costs.every((cost) => Number.isFinite(cost) && cost > 0));
  assert.ok(costs[7] < costs[8]);
  assert.ok(costs[8] < costs[9]);
  assert.throws(() => deriveStaticByteCosts([], { alpha: 0 }), /alpha/);
});

test("entropy shootout is deterministic, lossless, and never selects a larger DEFLATE group", () => {
  const first = benchmarkEntropyCorpus(manifest);
  const second = benchmarkEntropyCorpus(manifest);
  assert.deepEqual(first, second);
  assert.equal(first.format, ENTROPY_REPORT_VERSION);
  assert.equal(first.fixtures.length, STRUCTURAL_CLASSES.length);
  assert.ok(first.totals.selectedDeflateBytes <= first.totals.packedDeflateBytes);
  assert.equal(first.totals.canonicalSelectionSha256.length, 64);
  for (const fixture of first.fixtures) {
    assert.ok(fixture.selected.deflateBytes <= fixture.packed.deflateBytes);
    assert.equal(fixture.packed.canonicalTraceSha256.length, 64);
    assert.equal(fixture.entropyPass1.canonicalTraceSha256.length, 64);
    assert.equal(fixture.entropyPass2.canonicalTraceSha256.length, 64);
  }
});
