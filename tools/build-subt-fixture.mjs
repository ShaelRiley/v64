#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import {
  CADENCES,
  decodeSubtitleTimeline,
  demuxV64,
  encodeCellTimeline,
  makeChunk,
  muxV64,
  verifyV64
} from "../prototype/js/container.mjs";
import { encodeSubtitleMaskSequence } from "../prototype/js/subtitle-mask-sm2.mjs";

const outputDirectory = resolve(process.argv[2] || "bench/generated/subt");
mkdirSync(outputDirectory, { recursive: true });

const columns = 8;
const rows = 4;
const cellCount = columns * rows;
const cadenceId = 7;
const cadence = CADENCES[cadenceId];
const paletteDepthId = PALETTE_DEPTHS.indexOf(16);
const paletteDepth = PALETTE_DEPTHS[paletteDepthId];

function entry(cellIndex, foreground, background, rows16) {
  return {
    cellIndex,
    foreground,
    background,
    mask: Buffer.from(rows16)
  };
}

const captionA = [
  entry(24, 15, 0, [0x00, 0x18, 0x3c, 0x66, 0x66, 0x7e, 0x66, 0x66, 0x66, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  entry(25, 15, 0, [0x00, 0x7c, 0x66, 0x66, 0x7c, 0x66, 0x66, 0x66, 0x7c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
];
const captionB = [
  entry(26, 14, 0, [0x00, 0x3c, 0x66, 0x60, 0x60, 0x60, 0x66, 0x3c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  entry(27, 14, 0, [0x00, 0x78, 0x6c, 0x66, 0x66, 0x66, 0x6c, 0x78, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
];
const captionC = [
  entry(26, 14, 0, [0x00, 0x3c, 0x66, 0x60, 0x60, 0x60, 0x66, 0x3c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  entry(28, 13, 0, [0x00, 0x7e, 0x60, 0x60, 0x7c, 0x60, 0x60, 0x7e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
];

function sequence(frames) {
  return encodeSubtitleMaskSequence(frames, { cellCount, paletteDepth });
}

const subtitleChunks = [
  makeChunk(
    "SUBT",
    0,
    cadence.frameTicks * 2,
    sequence([captionA, captionA])
  ),
  makeChunk(
    "SUBT",
    cadence.frameTicks * 3,
    cadence.frameTicks * 3,
    sequence([captionB, captionB, captionC])
  )
];
const videoChunks = encodeCellTimeline(
  Array.from({ length: 6 }, () => Buffer.alloc(cellCount * 3)),
  { columns, rows, cadenceId, paletteDepthId, keyframeInterval: 3 }
);
const file = muxV64(
  { columns, rows, cadenceId, paletteDepthId },
  [...videoChunks, ...subtitleChunks]
);
const demuxed = demuxV64(file);
const subtitles = decodeSubtitleTimeline(demuxed);
const verification = verifyV64(file);

assert.equal(Boolean(demuxed.header.featureFlags & 0x80), true);
assert.equal(subtitles.chunks.length, 2);
assert.equal(subtitles.frameCount, 5);
assert.equal(subtitles.firstTimestamp, 0);
assert.equal(subtitles.lastTimestamp, cadence.frameTicks * 6);
assert.equal(verification.subtitleChunks, 2);
assert.equal(verification.subtitleFrames, 5);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = {
  format: "V64-SUBT-FIXTURE-1",
  container: {
    filename: "subt-container.v64",
    bytes: file.length,
    sha256: sha256(file),
    featureFlags: demuxed.header.featureFlags,
    subtitleFeatureDeclared: Boolean(demuxed.header.featureFlags & 0x80),
    verification
  },
  profile: {
    columns,
    rows,
    cellCount,
    cadenceId,
    frameTicks: cadence.frameTicks,
    paletteDepthId,
    paletteDepth,
    videoFrames: 6,
    subtitleFrames: subtitles.frameCount,
    sparseGapFrames: 1
  },
  chunks: subtitles.chunks.map((chunk, index) => ({
    index,
    timestamp: chunk.timestamp,
    duration: chunk.duration,
    frameCount: chunk.frameCount,
    cellCount: chunk.cellCount,
    paletteDepth: chunk.paletteDepth,
    payloadBytes: subtitleChunks[index].payload.length,
    payloadSha256: sha256(subtitleChunks[index].payload)
  }))
};

writeFileSync(resolve(outputDirectory, "subt-container.v64"), file);
writeFileSync(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
console.log(JSON.stringify(manifest, null, 2));
