import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeSubtitleMaskPlane,
  encodeSubtitleMaskPlane,
  extractSubtitleMaskPlane,
  rasterizeSubtitleMaskPlane
} from "../prototype/js/subtitle-mask.mjs";

const BLACK_WHITE = [[0, 0, 0], [255, 255, 255]];

function syntheticSubtitleRaster() {
  const columns = 2;
  const rows = 2;
  const width = columns * 8;
  const height = rows * 16;
  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba[offset + 3] = 255;

  const mask = Buffer.from([
    0x81, 0x81, 0x81, 0x81,
    0x81, 0xff, 0xff, 0x81,
    0x81, 0x81, 0x81, 0x81,
    0x81, 0x81, 0x81, 0x81
  ]);
  const cellX = 0;
  const cellY = 1;
  for (let py = 0; py < 16; py += 1) {
    for (let px = 0; px < 8; px += 1) {
      const white = Boolean(mask[py] & (0x80 >> px));
      const offset = (((cellY * 16 + py) * width) + cellX * 8 + px) * 4;
      rgba[offset] = white ? 255 : 0;
      rgba[offset + 1] = white ? 255 : 0;
      rgba[offset + 2] = white ? 255 : 0;
    }
  }
  return { columns, rows, width, height, rgba, mask };
}

test("subtitle-mask plane preserves exact 8x16 strokes in the lower band", () => {
  const fixture = syntheticSubtitleRaster();
  const entries = extractSubtitleMaskPlane(
    fixture.rgba,
    fixture.width,
    fixture.height,
    fixture.columns,
    fixture.rows,
    {
      palette: BLACK_WHITE,
      paletteDepth: 2,
      bandStart: 0.5,
      contrastFloor: 20
    }
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].cellIndex, 2);
  assert.deepEqual(entries[0].mask, fixture.mask);
  assert.equal(entries[0].foreground, 1);
  assert.equal(entries[0].background, 0);

  const encoded = encodeSubtitleMaskPlane(entries, {
    cellCount: fixture.columns * fixture.rows,
    paletteDepth: 2
  });
  const decoded = decodeSubtitleMaskPlane(encoded);
  assert.equal(decoded.cellCount, 4);
  assert.equal(decoded.paletteDepth, 2);
  assert.deepEqual(decoded.entries, entries);

  const image = rasterizeSubtitleMaskPlane(
    decoded,
    fixture.columns,
    fixture.rows,
    BLACK_WHITE
  );
  assert.equal(image.width, fixture.width);
  assert.equal(image.height, fixture.height);
  for (let py = 0; py < 16; py += 1) {
    for (let px = 0; px < 8; px += 1) {
      const offset = ((((1 * 16) + py) * fixture.width) + px) * 4;
      const expected = fixture.mask[py] & (0x80 >> px) ? 255 : 0;
      assert.equal(image.rgba[offset], expected);
      assert.equal(image.rgba[offset + 3], 255);
    }
  }
});

test("subtitle-mask decoding rejects truncation and non-progress records", () => {
  const valid = encodeSubtitleMaskPlane([{
    cellIndex: 0,
    mask: Buffer.alloc(16, 0xaa),
    foreground: 1,
    background: 0
  }], { cellCount: 4, paletteDepth: 2 });

  assert.throws(() => decodeSubtitleMaskPlane(valid.subarray(0, -1)), /Truncated/);
  const damaged = Buffer.from(valid);
  damaged[16] = 0;
  assert.throws(() => decodeSubtitleMaskPlane(damaged), /no progress/);
});
