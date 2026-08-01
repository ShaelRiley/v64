import assert from "node:assert/strict";
import test from "node:test";
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

const columns = 4;
const rows = 3;
const cellCount = columns * rows;
const cadenceId = 7;
const cadence = CADENCES[cadenceId];
const paletteDepthId = PALETTE_DEPTHS.indexOf(16);
const paletteDepth = PALETTE_DEPTHS[paletteDepthId];

function plane(cellIndex = 9, foreground = 15, background = 0, fill = 0x18) {
  return [{
    cellIndex,
    foreground,
    background,
    mask: Buffer.alloc(16, fill)
  }];
}

function subtitlePayload(frameCount = 2, options = {}) {
  return encodeSubtitleMaskSequence(
    Array.from({ length: frameCount }, (_, index) =>
      options.changing && index ? plane(10, 14, 0, 0x3c) : plane()),
    {
      cellCount: options.cellCount ?? cellCount,
      paletteDepth: options.paletteDepth ?? paletteDepth
    }
  );
}

function video(frameCount = 4) {
  return encodeCellTimeline(
    Array.from({ length: frameCount }, () => Buffer.alloc(cellCount * 3)),
    { columns, rows, cadenceId, paletteDepthId, keyframeInterval: 24 }
  );
}

function build(subtitleChunks = [], frameCount = 4) {
  return muxV64(
    { columns, rows, cadenceId, paletteDepthId },
    [...video(frameCount), ...subtitleChunks]
  );
}

function subt(timestamp, frameCount, payload = subtitlePayload(frameCount)) {
  return makeChunk(
    "SUBT",
    timestamp,
    frameCount * cadence.frameTicks,
    payload
  );
}

test("SUBT registers its feature bit and round-trips canonical SM2 payloads", () => {
  const file = build([subt(cadence.frameTicks, 2)]);
  const demuxed = demuxV64(file);
  const subtitles = decodeSubtitleTimeline(demuxed);
  const verified = verifyV64(file);

  assert.equal(Boolean(demuxed.header.featureFlags & 0x80), true);
  assert.equal(subtitles.chunks.length, 1);
  assert.equal(subtitles.frameCount, 2);
  assert.equal(subtitles.firstTimestamp, cadence.frameTicks);
  assert.equal(subtitles.lastTimestamp, cadence.frameTicks * 3);
  assert.equal(subtitles.chunks[0].sequence.cellCount, cellCount);
  assert.equal(subtitles.chunks[0].sequence.paletteDepth, paletteDepth);
  assert.equal(subtitles.chunks[0].sequence.frames.length, 2);
  assert.equal(verified.subtitleChunks, 1);
  assert.equal(verified.subtitleFrames, 2);
});

test("SUBT permits sparse non-overlapping coverage and changing planes", () => {
  const first = subt(0, 1, subtitlePayload(1));
  const second = subt(
    cadence.frameTicks * 2,
    2,
    subtitlePayload(2, { changing: true })
  );
  const subtitles = decodeSubtitleTimeline(demuxV64(build([second, first])));
  assert.equal(subtitles.chunks.length, 2);
  assert.equal(subtitles.frameCount, 3);
  assert.deepEqual(
    subtitles.chunks.map((chunk) => chunk.timestamp),
    [0, cadence.frameTicks * 2]
  );
  assert.notDeepEqual(
    subtitles.chunks[1].sequence.frames[0],
    subtitles.chunks[1].sequence.frames[1]
  );
});

test("SUBT feature declaration and chunk presence must agree", () => {
  const withChunk = build([subt(0, 1)]);
  const missingFlag = Buffer.from(withChunk);
  missingFlag.writeUInt32LE(missingFlag.readUInt32LE(12) & ~0x80, 12);
  assert.throws(() => verifyV64(missingFlag), /feature flag and chunk presence disagree/);

  const withoutChunk = build([]);
  const strayFlag = Buffer.from(withoutChunk);
  strayFlag.writeUInt32LE(strayFlag.readUInt32LE(12) | 0x80, 12);
  assert.throws(() => verifyV64(strayFlag), /feature flag and chunk presence disagree/);
});

test("SUBT timing must be frame-aligned, bounded, and non-overlapping", () => {
  assert.throws(
    () => verifyV64(build([
      makeChunk("SUBT", 1, cadence.frameTicks, subtitlePayload(1))
    ])),
    /whole nominal frame spans/
  );
  assert.throws(
    () => verifyV64(build([
      makeChunk("SUBT", 0, cadence.frameTicks + 1, subtitlePayload(1))
    ])),
    /whole nominal frame spans/
  );
  assert.throws(
    () => verifyV64(build([
      subt(0, 2),
      subt(cadence.frameTicks, 1)
    ])),
    /overlap/
  );

  const beyond = Buffer.from(build([
    subt(cadence.frameTicks, 2)
  ], 2));
  beyond.writeBigUInt64LE(BigInt(cadence.frameTicks * 2), 28);
  assert.throws(() => verifyV64(beyond), /exceeds the declared file duration/);
});

test("SUBT payload metadata must agree with the active V64 header", () => {
  assert.throws(
    () => verifyV64(build([
      subt(0, 1, subtitlePayload(1, { cellCount: cellCount + 1 }))
    ])),
    /cell count disagrees/
  );
  assert.throws(
    () => verifyV64(build([
      subt(0, 1, subtitlePayload(1, { paletteDepth: 32 }))
    ])),
    /palette depth disagrees/
  );
  assert.throws(
    () => verifyV64(build([
      subt(0, 2, subtitlePayload(1))
    ])),
    /frame count disagrees/
  );
});

test("SUBT rejects noncanonical or malformed SM2 payloads", () => {
  const trailing = Buffer.concat([subtitlePayload(1), Buffer.from([0])]);
  assert.throws(
    () => verifyV64(build([subt(0, 1, trailing)])),
    /Trailing SM2 sequence bytes/
  );

  const corruptMagic = Buffer.from(subtitlePayload(1));
  corruptMagic[0] ^= 0xff;
  assert.throws(
    () => verifyV64(build([subt(0, 1, corruptMagic)])),
    /Invalid SM2 sequence header/
  );
});

test("feature bits above the registered SUBT boundary remain mandatory-unknown", () => {
  const file = Buffer.from(build([subt(0, 1)]));
  file.writeUInt32LE(file.readUInt32LE(12) | 0x100, 12);
  assert.throws(() => verifyV64(file), /Unknown mandatory header feature bits/);
});
