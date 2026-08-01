import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeSubtitleMaskSequence,
  encodeSubtitleMaskSequence,
  measureSubtitleMaskSequence,
  selectSubtitleRegions
} from "../prototype/js/subtitle-mask-sm2.mjs";

const PALETTE = [[0, 0, 0], [255, 255, 255]];
const TEXT_MASK = Buffer.from([
  0x00, 0x00, 0x7e, 0x42, 0x42, 0x7e, 0x42, 0x42,
  0x42, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

function entry(cellIndex, mask = TEXT_MASK) {
  return { cellIndex, foreground: 1, background: 0, mask: Buffer.from(mask) };
}

function plain(frames) {
  return frames.map((frame) => frame.map((item) => ({
    cellIndex: item.cellIndex,
    foreground: item.foreground,
    background: item.background,
    mask: [...item.mask]
  })));
}

test("SM2 region selection keeps broad subtitle-like lines and drops isolated noise", () => {
  const columns = 20;
  const rows = 8;
  const subtitle = Array.from({ length: 9 }, (_, index) => entry(6 * columns + 5 + index));
  const noise = [entry(5 * columns + 1), entry(7 * columns + 18)];
  const selected = selectSubtitleRegions(
    [...noise, ...subtitle].sort((a, b) => a.cellIndex - b.cellIndex),
    columns,
    rows,
    {
      palette: PALETTE,
      paletteDepth: 2,
      bandStart: 0.5,
      minWidthCells: 7,
      maxHeightCells: 2,
      contrastFloor: 80
    }
  );
  assert.deepEqual(selected.map((item) => item.cellIndex), subtitle.map((item) => item.cellIndex));
});

test("SM2 round trips full, repeated, delta, and removal planes", () => {
  const first = [entry(10), entry(11), entry(12)];
  const changedMask = Buffer.from(TEXT_MASK);
  changedMask[5] ^= 0x18;
  const changed = [entry(10), entry(11, changedMask), entry(12), entry(13)];
  const removed = [entry(10), entry(11, changedMask), entry(13)];
  const frames = [first, first, changed, changed, removed];
  const encoded = encodeSubtitleMaskSequence(frames, { cellCount: 80, paletteDepth: 2 });
  const decoded = decodeSubtitleMaskSequence(encoded);
  assert.equal(decoded.frameCount, frames.length);
  assert.deepEqual(plain(decoded.frames), plain(frames));
  assert.ok(encoded.includes(0x00), "repeat opcode should be present");
  assert.ok(encoded.includes(0x02), "delta opcode should be present");

  const metrics = measureSubtitleMaskSequence(frames, { cellCount: 80, paletteDepth: 2 });
  assert.equal(metrics.frames, 5);
  assert.equal(metrics.bytes, encoded.length);
  assert.ok(metrics.deflateBytes > 0);
  assert.match(metrics.sha256, /^[0-9a-f]{64}$/);
});

test("SM2 rejects repeat-before-first-frame and trailing bytes", () => {
  const valid = encodeSubtitleMaskSequence([[entry(2)]], {
    cellCount: 8,
    paletteDepth: 2
  });
  const repeatFirst = Buffer.from(valid);
  repeatFirst[16] = 0x00;
  repeatFirst[17] = 0x01;
  assert.throws(() => decodeSubtitleMaskSequence(repeatFirst), /repeat precedes/);
  assert.throws(
    () => decodeSubtitleMaskSequence(Buffer.concat([valid, Buffer.from([0])])),
    /Trailing/
  );
});
