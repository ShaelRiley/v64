import assert from "node:assert/strict";
import test from "node:test";
import { stabilizeSubtitleSpans } from "../prototype/js/subtitle-mask-sm5.mjs";

const MASK = Buffer.from([
  0x00,0x00,0x7e,0x42,0x42,0x7e,0x42,0x42,
  0x42,0x00,0x00,0x00,0x00,0x00,0x00,0x00
]);
function entry(cellIndex) {
  return { cellIndex, foreground: 1, background: 0, mask: Buffer.from(MASK) };
}
function frame(cells) {
  return cells.map(entry);
}
function plain(frames) {
  return frames.map((items) => items.map((item) => ({
    cellIndex: item.cellIndex,
    foreground: item.foreground,
    background: item.background,
    mask: [...item.mask]
  })));
}

test("SM5 span stabilization preserves two changing captions", () => {
  const first = frame([10,11,12,13,14,15]);
  const second = frame([20,21,22,23,24,25]);
  const frames = [first, first, first, first, second, second, second, second];
  const before = plain(frames);
  const options = {
    cellCount: 80,
    paletteDepth: 2,
    boundarySimilarity: 0.4,
    minimumSpanFrames: 2,
    minimumFrameFraction: 0.5
  };
  const result = stabilizeSubtitleSpans(frames, options);
  const repeated = stabilizeSubtitleSpans(frames, options);
  assert.deepEqual(plain(frames), before, "SM5 must not mutate source frames");
  assert.deepEqual(plain(result.frames), plain(repeated.frames), "SM5 output must be deterministic");
  assert.deepEqual(result.spans, repeated.spans, "SM5 boundaries must be deterministic");
  assert.equal(result.spans.length, 2);
  assert.deepEqual(result.spans.map((span) => [span.startFrame, span.endFrame]), [[0,4],[4,8]]);
  assert.deepEqual(result.frames[0].map((item) => item.cellIndex), [10,11,12,13,14,15]);
  assert.deepEqual(result.frames[7].map((item) => item.cellIndex), [20,21,22,23,24,25]);
});

test("SM5 span stabilization ignores one sparse transition frame", () => {
  const caption = frame([10,11,12,13,14,15]);
  const frames = [caption, caption, [], caption, caption];
  const result = stabilizeSubtitleSpans(frames, {
    cellCount: 80,
    paletteDepth: 2,
    boundarySimilarity: 0.4,
    minimumSpanFrames: 2,
    sparseFrameCells: 1,
    minimumFrameFraction: 0.4
  });
  assert.equal(result.spans.length, 1);
  assert.deepEqual(result.frames[2].map((item) => item.cellIndex), [10,11,12,13,14,15]);
});

test("SM5 span stabilization validates boundary options", () => {
  const frames = [frame([1]), frame([1])];
  assert.throws(() => stabilizeSubtitleSpans(frames, {
    cellCount: 10,
    paletteDepth: 2,
    boundarySimilarity: 2
  }), /Invalid SM5 span/);
  assert.throws(() => stabilizeSubtitleSpans(frames, {
    cellCount: 10,
    paletteDepth: 2,
    minimumSpanFrames: 3
  }), /Invalid SM5 span/);
});
