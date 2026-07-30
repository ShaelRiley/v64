import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeSubtitleMaskPlane,
  encodeSubtitleMaskPlane
} from "../prototype/js/subtitle-mask.mjs";
import {
  compositeSubtitleMaskPlane,
  measureSubtitleMaskPlanes
} from "../prototype/js/subtitle-mask-preview.mjs";

const PALETTE = [[0, 0, 0], [255, 255, 255], [12, 34, 56]];

function solidImage(width, height, rgb) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = rgb[0];
    rgba[offset + 1] = rgb[1];
    rgba[offset + 2] = rgb[2];
    rgba[offset + 3] = 255;
  }
  return { width, height, rgba };
}

test("subtitle-mask composite replaces only declared 8x16 cells", () => {
  const base = solidImage(16, 16, PALETTE[2]);
  const mask = Buffer.from([
    0x18, 0x3c, 0x66, 0xc3,
    0xc3, 0xff, 0xff, 0xc3,
    0xc3, 0xc3, 0xc3, 0xc3,
    0xc3, 0xc3, 0xc3, 0x00
  ]);
  const encoded = encodeSubtitleMaskPlane([{
    cellIndex: 1,
    mask,
    foreground: 1,
    background: 0
  }], { cellCount: 2, paletteDepth: 3 });
  const decoded = decodeSubtitleMaskPlane(encoded);
  const composite = compositeSubtitleMaskPlane(base, decoded, 2, 1, PALETTE);

  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const offset = (y * 16 + x) * 4;
      assert.deepEqual([...composite.rgba.subarray(offset, offset + 3)], PALETTE[2]);
    }
    for (let x = 0; x < 8; x += 1) {
      const offset = (y * 16 + 8 + x) * 4;
      const expected = mask[y] & (0x80 >> x) ? PALETTE[1] : PALETTE[0];
      assert.deepEqual([...composite.rgba.subarray(offset, offset + 3)], expected);
    }
  }
});

test("subtitle-mask byte accounting is deterministic and stream-framed", () => {
  const empty = encodeSubtitleMaskPlane([], { cellCount: 2, paletteDepth: 3 });
  const occupied = encodeSubtitleMaskPlane([{
    cellIndex: 1,
    mask: Buffer.alloc(16, 0xaa),
    foreground: 1,
    background: 0
  }], { cellCount: 2, paletteDepth: 3 });
  const first = measureSubtitleMaskPlanes([empty, occupied, occupied]);
  const second = measureSubtitleMaskPlanes([empty, occupied, occupied]);
  assert.deepEqual(first, second);
  assert.equal(first.frames, 3);
  assert.equal(first.payloadBytes, empty.length + occupied.length * 2);
  assert.equal(first.framingBytes, 12);
  assert.equal(first.framedBytes, first.payloadBytes + first.framingBytes);
  assert.equal(first.uniquePlanes, 2);
  assert.equal(first.changedPlanes, 1);
  assert.equal(first.sha256.length, 64);
  assert.ok(first.deflateBytes < first.framedBytes);
});
