import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeSubtitleMaskSequence,
  encodeSubtitleMaskSequence
} from "../prototype/js/subtitle-mask-sm2.mjs";
import { stabilizeSubtitlePlane } from "../prototype/js/subtitle-mask-sm4.mjs";

const MASK_A = Buffer.from([
  0x00,0x00,0x7e,0x42,0x42,0x7e,0x42,0x42,
  0x42,0x00,0x00,0x00,0x00,0x00,0x00,0x00
]);
const MASK_B = Buffer.from(MASK_A);
MASK_B[5] ^= 0x18;

function entry(cellIndex, mask = MASK_A, foreground = 1, background = 0) {
  return { cellIndex, mask: Buffer.from(mask), foreground, background };
}

function plain(frames) {
  return frames.map((frame) => frame.map((item) => ({
    cellIndex: item.cellIndex,
    foreground: item.foreground,
    background: item.background,
    mask: [...item.mask]
  })));
}

test("SM4 creates one stable consensus plane and repeatable sequence", () => {
  const frames = [
    [entry(10), entry(11, MASK_A)],
    [entry(10), entry(11, MASK_B)],
    [entry(10), entry(11, MASK_A)],
    [entry(10), entry(11, MASK_B)]
  ];
  const before = plain(frames);
  const result = stabilizeSubtitlePlane(frames, {
    cellCount: 40,
    paletteDepth: 2,
    minimumFrameFraction: 0.5,
    bitThreshold: 0.5
  });
  assert.deepEqual(plain(frames), before, "SM4 must not mutate source frames");
  assert.equal(result.plane.length, 2);
  assert.equal(result.frames.length, 4);
  for (const frame of result.frames) assert.deepEqual(plain([frame]), plain([result.plane]));
  assert.equal(result.diagnostics.sourceSelectedCells, 8);
  assert.equal(result.diagnostics.stabilizedCellFrames, 8);

  const encoded = encodeSubtitleMaskSequence(result.frames, {
    cellCount: 40,
    paletteDepth: 2
  });
  assert.ok(encoded.includes(0x00), "stable sequence should contain a repeat opcode");
  const decoded = decodeSubtitleMaskSequence(encoded);
  assert.deepEqual(plain(decoded.frames), plain(result.frames));
  assert.equal(decoded.frameCount, result.frames.length);
});

test("SM4 removes transient cells and chooses modal palette pair", () => {
  const frames = [
    [entry(4, MASK_A, 1, 0), entry(9)],
    [entry(4, MASK_A, 1, 0)],
    [entry(4, MASK_A, 2, 0)],
    [entry(4, MASK_A, 1, 0)]
  ];
  const result = stabilizeSubtitlePlane(frames, {
    cellCount: 20,
    paletteDepth: 3,
    minimumFrameFraction: 0.5
  });
  assert.deepEqual(result.plane.map((item) => item.cellIndex), [4]);
  assert.equal(result.plane[0].foreground, 1);
  assert.equal(result.plane[0].background, 0);
  assert.equal(result.diagnostics.minimumFrames, 2);
});

test("SM4 validates persistence and mask thresholds", () => {
  const frames = [[entry(1)], [entry(1)]];
  assert.throws(() => stabilizeSubtitlePlane(frames, {
    cellCount: 4,
    paletteDepth: 2,
    minimumFrameFraction: 0
  }), /Invalid SM4/);
  assert.throws(() => stabilizeSubtitlePlane(frames, {
    cellCount: 4,
    paletteDepth: 2,
    bitThreshold: 1.1
  }), /Invalid SM4/);
  assert.throws(() => stabilizeSubtitlePlane(frames, {
    cellCount: 4,
    paletteDepth: 2,
    minimumMaskBits: 10,
    maximumMaskBits: 5
  }), /Invalid SM4/);
});
