import assert from "node:assert/strict";
import test from "node:test";
import { selectSubtitleRegions } from "../prototype/js/subtitle-mask-sm2.mjs";
import { selectSubtitleRegionsTemporally } from "../prototype/js/subtitle-mask-sm3.mjs";

const PALETTE = [[0, 0, 0], [255, 255, 255]];
const MASK = Buffer.from([
  0x00, 0x00, 0x7e, 0x42, 0x42, 0x7e, 0x42, 0x42,
  0x42, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

function entry(cellIndex) {
  return { cellIndex, foreground: 1, background: 0, mask: Buffer.from(MASK) };
}

function cellsAt(columns, y, xs) {
  return xs.map((x) => entry(y * columns + x));
}

function plain(frames) {
  return frames.map((frame) => frame.map((item) => ({
    cellIndex: item.cellIndex,
    foreground: item.foreground,
    background: item.background,
    mask: [...item.mask]
  })));
}

test("temporal aggregation joins persistent subtitle fragments that static SM2 misses", () => {
  const columns = 20;
  const rows = 8;
  const line = [...cellsAt(columns, 6, [3, 4, 5, 6]), ...cellsAt(columns, 6, [10, 11, 12, 13])];
  const noise = entry(7 * columns + 18);
  const frames = Array.from({ length: 8 }, () =>
    [...line, noise].sort((a, b) => a.cellIndex - b.cellIndex));
  const before = plain(frames);
  const options = {
    palette: PALETTE,
    paletteDepth: 2,
    bandStart: 0.5,
    minWidthCells: 6,
    maxHeightCells: 2,
    maxGap: 2,
    temporalGap: 3,
    persistenceFrames: 2,
    sparseFloor: 8,
    expansionX: 1
  };

  assert.equal(selectSubtitleRegions(frames[0], columns, rows, options).length, 0);
  const result = selectSubtitleRegionsTemporally(frames, columns, rows, options);
  assert.deepEqual(plain(frames), before, "temporal selection must not mutate source frames");
  assert.equal(result.frames.length, frames.length);
  assert.ok(result.diagnostics.boxes.length >= 1);
  assert.equal(result.diagnostics.fallbackFrames, frames.length);
  assert.equal(result.diagnostics.staticSelectedCells, 0);
  assert.equal(result.diagnostics.temporalSelectedCells, line.length * frames.length);
  for (const frame of result.frames) {
    assert.deepEqual(frame.map((item) => item.cellIndex), line.map((item) => item.cellIndex));
  }
});

test("temporal fallback leaves an already sufficient static line unchanged", () => {
  const columns = 20;
  const rows = 8;
  const line = cellsAt(columns, 6, [4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const frames = Array.from({ length: 4 }, () => line.map((item) => ({ ...item, mask: Buffer.from(item.mask) })));
  const options = {
    palette: PALETTE,
    paletteDepth: 2,
    bandStart: 0.5,
    minWidthCells: 7,
    sparseFloor: 8,
    persistenceFrames: 2
  };
  const staticSelection = selectSubtitleRegions(frames[0], columns, rows, options);
  assert.equal(staticSelection.length, line.length);
  const result = selectSubtitleRegionsTemporally(frames, columns, rows, options);
  assert.equal(result.diagnostics.fallbackFrames, 0);
  assert.deepEqual(plain(result.frames), plain(frames));
});

test("temporal selector validates persistence and fallback bounds", () => {
  const frames = [[entry(10)], [entry(10)]];
  assert.throws(
    () => selectSubtitleRegionsTemporally(frames, 8, 4, { paletteDepth: 2, persistenceFrames: 3 }),
    /Invalid SM3/
  );
  assert.throws(
    () => selectSubtitleRegionsTemporally(frames, 8, 4, {
      paletteDepth: 2,
      sparseFloor: 10,
      maxCellsPerFrame: 9
    }),
    /Invalid SM3/
  );
});
