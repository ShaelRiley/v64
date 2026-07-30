import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HYPERREAL_ANCHORS,
  generateHyperRealMasterPalette,
  hyperRealGrade,
  paletteBytes,
  paletteHash
} from "../tools/hyperreal-palette-generator.mjs";
import {
  analyzeRasterEntry,
  benchmarkRasterCorpus,
  validateRasterCorpusManifest
} from "../prototype/js/raster-corpus.mjs";

const rasterManifest = JSON.parse(readFileSync(
  new URL("../bench/corpus/raster-manifest.json", import.meta.url),
  "utf8"
));
const humanManifest = JSON.parse(readFileSync(
  new URL("../bench/corpus/human-raster-manifest.json", import.meta.url),
  "utf8"
));

test("Hyper Real candidate preserves canonical ANSI Tube anchors and is reproducible", () => {
  const first = generateHyperRealMasterPalette();
  const second = generateHyperRealMasterPalette();
  assert.deepEqual(first, second);
  assert.equal(first.length, 256);
  assert.deepEqual(first.slice(0, HYPERREAL_ANCHORS.length), HYPERREAL_ANCHORS);
  assert.equal(new Set(first.map((color) => color.join(","))).size, 256);
  assert.equal(
    paletteHash(first),
    "47a136bb5abdabea6ae22387ba9496cee398000c958104ad7f542ab1034785d2"
  );
  assert.deepEqual(hyperRealGrade([128, 80, 40]), [154, 68, 0]);

  const metadata = JSON.parse(readFileSync(
    new URL("../assets/palettes/v64-p256-hyperreal-candidate-2.json", import.meta.url),
    "utf8"
  ));
  const bytes = readFileSync(
    new URL("../assets/palettes/v64-p256-hyperreal-candidate-2.rgb", import.meta.url)
  );
  assert.equal(metadata.source.palette, "hyperreal");
  assert.equal(metadata.source.blobSha, "29fd2065612454a66a92e431213731c41d5dc28c");
  assert.equal(metadata.sha256, paletteHash(first));
  assert.deepEqual(bytes, paletteBytes(first));
});

test("raster manifest verifies licensing, source hash, and deterministic cell analysis", () => {
  const manifest = validateRasterCorpusManifest(rasterManifest);
  assert.equal(manifest.entries[0].source.license, "CC0-1.0");
  const first = analyzeRasterEntry(manifest.entries[0]);
  const second = analyzeRasterEntry(manifest.entries[0]);
  assert.equal(first.frames.length, 48);
  assert.deepEqual(first.frames, second.frames);
  assert.equal(first.sourceSha256, manifest.entries[0].source.sha256);
  assert.throws(() => analyzeRasterEntry({
    ...manifest.entries[0],
    source: { ...manifest.entries[0].source, sha256: "0".repeat(64) }
  }), /hash mismatch/);
});

test("raster entropy benchmark is lossless and retains a no-regression baseline", () => {
  const report = benchmarkRasterCorpus(rasterManifest, {
    groupDurationsSeconds: [],
    measurePerformance: false
  });
  assert.equal(report.rasterSources.length, 1);
  assert.equal(report.rasterSources[0].analyzedFrames, 48);
  assert.ok(report.totals.selectedDeflateBytes <= report.totals.packedDeflateBytes);
  assert.equal(report.totals.canonicalSelectionSha256.length, 64);
});

test("human raster tranche compares both palette assets on identical licensed sources", () => {
  const manifest = validateRasterCorpusManifest(humanManifest);
  assert.equal(manifest.entries.length, 6);
  assert.ok(manifest.entries.every((entry) => entry.source.license === "CC0-1.0"));
  assert.deepEqual(
    [...new Set(manifest.entries.map((entry) => entry.paletteAsset))].sort(),
    ["V64-P256-CANDIDATE-1", "V64-P256-HYPERREAL-CANDIDATE-2"]
  );

  const candidate1 = analyzeRasterEntry(manifest.entries[0]);
  const hyperReal = analyzeRasterEntry(manifest.entries[1]);
  assert.equal(candidate1.sourceSha256, hyperReal.sourceSha256);
  assert.equal(candidate1.frames.length, 24);
  assert.equal(hyperReal.frames.length, 24);
  assert.notDeepEqual(candidate1.frames, hyperReal.frames);
  assert.ok(candidate1.analysisMetrics.changedCellPercent > 0);
  assert.ok(hyperReal.analysisMetrics.changedCellPercent > 0);
  assert.ok(candidate1.analysisMetrics.flickerReversionPercent >= 0);
  for (const frame of [...candidate1.frames, ...hyperReal.frames]) {
    for (let offset = 0; offset < frame.length; offset += 3) {
      assert.ok(frame[offset] < 64);
      assert.ok(frame[offset + 1] < 16);
      assert.ok(frame[offset + 2] < 16);
    }
  }
});
