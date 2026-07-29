import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CADENCES, PALETTE_DEPTHS, cadenceFromValue, paletteDepthFromValue
} from "../prototype/js/constants.mjs";
import {
  decodeParticleEvents, decodeVideoTimeline, demuxV64, encodeCellTimeline,
  encodeParticleEvents, makeChunk, muxV64, verifyV64
} from "../prototype/js/container.mjs";

function patternedFrame(columns, rows, phase, depth = 16) {
  const cells = Buffer.alloc(columns * rows * 3);
  for (let cell = 0; cell < columns * rows; cell += 1) {
    cells[cell * 3] = (cell + phase) % 64;
    cells[cell * 3 + 1] = (cell + phase) % depth;
    cells[cell * 3 + 2] = (cell * 3 + phase) % depth;
  }
  return cells;
}

function build({ cadenceId = 7, paletteDepthId = 6, frames = null, extra = [] } = {}) {
  const columns = 4;
  const rows = 3;
  const paletteDepth = PALETTE_DEPTHS[paletteDepthId];
  const sourceFrames = frames || [patternedFrame(columns, rows, 0, paletteDepth), patternedFrame(columns, rows, 1, paletteDepth)];
  const video = encodeCellTimeline(sourceFrames, { columns, rows, cadenceId, paletteDepthId, keyframeInterval: 10 });
  return muxV64({ columns, rows, cadenceId, paletteDepthId }, [...video, ...extra]);
}

test("all eleven legal cadences encode, parse, and verify", () => {
  for (const cadence of CADENCES) {
    const file = build({ cadenceId: cadence.id });
    const parsed = demuxV64(file);
    assert.equal(parsed.header.cadence.id, cadence.id);
    assert.equal(verifyV64(file).frames, 2);
  }
});

test("illegal nominal cadences are rejected", () => {
  for (const illegal of ["0", "0.25", "2", "23.976", "25", "120", "-1", "banana"]) {
    assert.throws(() => cadenceFromValue(illegal), /Illegal V64 cadence/);
  }
  const file = build();
  file[20] = 11;
  assert.throws(() => demuxV64(file), /Illegal V64 cadence ID/);
});

test("every legal palette depth round-trips and every illegal depth is rejected", () => {
  for (let id = 0; id < PALETTE_DEPTHS.length; id += 1) {
    const file = build({ paletteDepthId: id });
    assert.equal(demuxV64(file).header.paletteDepth, PALETTE_DEPTHS[id]);
    assert.equal(verifyV64(file).valid, true);
  }
  for (const illegal of [0, 1, 5, 10, 255, 257, "truecolor"]) {
    assert.throws(() => paletteDepthFromValue(illegal), /Illegal V64 palette depth/);
  }
});

test("repeat-frame spans retain exact timeline duration", () => {
  const source = patternedFrame(4, 3, 0, 16);
  const file = build({ frames: [source, source, source, patternedFrame(4, 3, 1, 16)] });
  const demuxed = demuxV64(file);
  const timeline = decodeVideoTimeline(demuxed);
  assert.equal(timeline.filter((item) => item.repeat).length, 1);
  assert.equal(verifyV64(file).frames, 4);
});

test("particle events and explicit silence chunks are bounded and deterministic", () => {
  const event = {
    classId: 2, color: 1, x: 32768, y: 16384, intensity: 96, radius: 40,
    lifetimeTicks: 3000, direction: -1200, spread: 2048, seed: 0x12345678
  };
  const payload = encodeParticleEvents([event]);
  assert.deepEqual(decodeParticleEvents(payload, 16), [event]);
  const cadence = CADENCES[7];
  const extra = [
    makeChunk("SILN", 0, cadence.frameTicks * 2, Buffer.alloc(0), { compress: false }),
    makeChunk("PLIT", cadence.frameTicks, cadence.frameTicks, payload, { compress: false })
  ];
  const file = build({ extra });
  assert.equal(verifyV64(file).valid, true);
  assert.throws(() => decodeParticleEvents(Buffer.from([65]), 16), /Malformed/);
});

test("seek index references actual keyframes and survives repeated parsing", () => {
  const frames = Array.from({ length: 7 }, (_, index) => patternedFrame(4, 3, index, 16));
  const columns = 4;
  const rows = 3;
  const chunks = encodeCellTimeline(frames, {
    columns, rows, cadenceId: 7, paletteDepthId: 6, keyframeInterval: 3
  });
  const file = muxV64({ columns, rows, cadenceId: 7, paletteDepthId: 6 }, chunks);
  const first = demuxV64(file);
  const second = demuxV64(file);
  assert.ok(first.index.length >= 2);
  assert.deepEqual(first.index, second.index);
  assert.deepEqual(decodeVideoTimeline(first).map((item) => item.state),
    decodeVideoTimeline(second).map((item) => item.state));
});

test("malformed chunks, truncation, excessive lengths, CRC, and asset mismatches fail closed", () => {
  const original = build();
  assert.throws(() => demuxV64(original.subarray(0, original.length - 1)), /Truncated|outside file|disagreement/);

  const badHash = Buffer.from(original);
  badHash[36] ^= 0xff;
  assert.throws(() => demuxV64(badHash), /glyph asset hash mismatch/);

  const badCrc = Buffer.from(original);
  badCrc[128 + 28] ^= 0xff;
  assert.throws(() => demuxV64(badCrc), /CRC mismatch/);

  const excessive = Buffer.from(original);
  excessive.writeUInt32LE(0xffff_ffff, 128 + 24);
  assert.throws(() => demuxV64(excessive), /oversized/);

  const unknown = Buffer.from(original);
  unknown.write("BORK", 128, 4, "ascii");
  assert.throws(() => demuxV64(unknown), /Unknown mandatory chunk/);
});

test("binary output and decoded cell states are deterministic", () => {
  const first = build();
  const second = build();
  assert.deepEqual(first, second);
  const firstStates = decodeVideoTimeline(demuxV64(first)).map((item) => item.state);
  const secondStates = decodeVideoTimeline(demuxV64(second)).map((item) => item.state);
  assert.deepEqual(firstStates, secondStates);
  assert.equal(createHash("sha256").update(first).digest("hex").length, 64);
});
