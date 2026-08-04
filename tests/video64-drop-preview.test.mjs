import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DROP_PREVIEW_FORMAT,
  DROP_SIZE_ESTIMATE_FORMAT,
  combineDropPreviewFrames,
  estimateDropBytesFromSamples,
  planDropSamples,
  writeDropPreviewPpm
} from "../apps/video64-drop/preview.mjs";

test("sample planning covers start, middle, and end without duplicates", () => {
  assert.deepEqual(planDropSamples(60), {
    sourceDurationSeconds: 60,
    requestedSampleSeconds: 2,
    sampleSeconds: 2,
    requestedSampleCount: 3,
    sampleCount: 3,
    offsets: [0, 29, 58]
  });
  assert.deepEqual(planDropSamples(1), {
    sourceDurationSeconds: 1,
    requestedSampleSeconds: 2,
    sampleSeconds: 1,
    requestedSampleCount: 3,
    sampleCount: 1,
    offsets: [0]
  });
});

test("sample planning rejects unavailable durations and unbounded sample counts", () => {
  assert.throws(() => planDropSamples(0), /positive source duration/);
  assert.throws(() => planDropSamples(10, { sampleCount: 10 }), /1 to 9/);
});

test("size estimation is advisory and preserves exact verification authority", () => {
  const estimate = estimateDropBytesFromSamples({
    durationSeconds: 120,
    videoBitsPerSecond: [40_000, 80_000, 60_000],
    audioPresent: true,
    sampleSeconds: 2
  });
  assert.equal(estimate.format, DROP_SIZE_ESTIMATE_FORMAT);
  assert.equal(estimate.advisory, true);
  assert.equal(estimate.exactPostEncodeVerificationRequired, true);
  assert.equal(estimate.sampleCount, 3);
  assert.equal(estimate.sampledMinimumVideoBitsPerSecond, 40_000);
  assert.equal(estimate.sampledMedianVideoBitsPerSecond, 60_000);
  assert.equal(estimate.sampledMaximumVideoBitsPerSecond, 80_000);
  assert.equal(estimate.nominalAudioBitsPerSecond, 8_000);
  assert.equal(estimate.estimatedBitsPerSecond, 68_000);
  assert.ok(estimate.lowerBytes <= estimate.estimatedBytes);
  assert.ok(estimate.upperBytes >= estimate.estimatedBytes);
  assert.match(estimate.rangeMeaning, /not a statistical confidence interval/i);
});

test("preview composition places source left and decoded V64 right", () => {
  const left = {
    width: 1,
    height: 1,
    rgba: Buffer.from([1, 2, 3, 255])
  };
  const right = {
    width: 1,
    height: 1,
    rgba: Buffer.from([4, 5, 6, 255])
  };
  const combined = combineDropPreviewFrames(left, right, 1);
  assert.equal(combined.width, 3);
  assert.equal(combined.height, 1);
  assert.deepEqual([...combined.rgba], [
    1, 2, 3, 255,
    0, 0, 0, 255,
    4, 5, 6, 255
  ]);
});

test("preview PPM output is deterministic and standards-readable", () => {
  const directory = mkdtempSync(join(tmpdir(), "video64-drop-preview-test-"));
  try {
    const path = join(directory, "preview.ppm");
    const bytes = writeDropPreviewPpm(path, {
      width: 2,
      height: 1,
      rgba: Buffer.from([
        1, 2, 3, 255,
        4, 5, 6, 255
      ])
    });
    const file = readFileSync(path);
    assert.equal(bytes, file.length);
    assert.equal(file.subarray(0, 11).toString("ascii"), "P6\n2 1\n255\n");
    assert.deepEqual([...file.subarray(11)], [1, 2, 3, 4, 5, 6]);
    assert.equal(DROP_PREVIEW_FORMAT, "VIDEO64-DROP-PREVIEW-1");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
