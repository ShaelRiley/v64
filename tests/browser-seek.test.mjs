import assert from "node:assert/strict";
import test from "node:test";
import {
  applyViewportScanlines,
  decodeSm2Sequence,
  sha256
} from "../prototype/browser/seek-conformance.mjs";

function varuint(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}

function entry(cellIndex, foreground, background, fill) {
  return {
    cellIndex,
    foreground,
    background,
    mask: Buffer.alloc(16, fill)
  };
}

function records(entries) {
  const parts = [];
  let previous = -1;
  for (const item of entries) {
    parts.push(
      varuint(item.cellIndex - previous),
      Buffer.from([item.foreground, item.background]),
      item.mask
    );
    previous = item.cellIndex;
  }
  return Buffer.concat(parts);
}

function sm2Fixture() {
  const header = Buffer.alloc(16);
  header.write("SM2\0", 0, 4, "binary");
  header.writeUInt32LE(8, 4);
  header.writeUInt32LE(4, 8);
  header.writeUInt16LE(16, 12);
  const first = [entry(4, 1, 0, 0x18)];
  const second = [entry(5, 4, 0, 0x3c)];
  return Buffer.concat([
    header,
    Buffer.from([1]),
    varuint(first.length),
    records(first),
    Buffer.from([0]),
    varuint(1),
    Buffer.from([2]),
    varuint(1),
    varuint(5),
    varuint(1),
    records(second),
    Buffer.from([0]),
    varuint(1)
  ]);
}

test("portable SM2 decoding preserves full, repeat, removal, and upsert states", () => {
  const decoded = decodeSm2Sequence(sm2Fixture());
  assert.equal(decoded.cellCount, 8);
  assert.equal(decoded.paletteDepth, 16);
  assert.equal(decoded.frameCount, 4);
  assert.deepEqual(decoded.frames.map((frame) => frame.map((item) => item.cellIndex)), [
    [4],
    [4],
    [5],
    [5]
  ]);
  assert.equal(decoded.frames[0][0].mask[0], 0x18);
  assert.equal(decoded.frames[2][0].mask[0], 0x3c);
});

test("portable scanlines use viewport coordinates and never mutate source bytes", () => {
  const rgba = Uint8Array.from({ length: 4 * 4 }, (_, index) =>
    index % 4 === 3 ? 255 : 200);
  const before = new Uint8Array(rgba);
  const output = applyViewportScanlines(
    { width: 1, height: 4, rgba },
    { viewportY: 3, strength: 0.18, period: 2, phase: 1 }
  );
  assert.deepEqual(rgba, before);
  assert.deepEqual(
    Array.from({ length: 4 }, (_, y) => output.rgba[y * 4]),
    [164, 200, 164, 200]
  );
});

test("portable SHA-256 matches the canonical digest", async () => {
  assert.equal(
    await sha256(Buffer.from("V64 browser seek")),
    "c5a44b0a21828c133ac28d281d92be9e6f23cde2e38ea59ea3846f33df83041b"
  );
});

test("portable browser helpers reject malformed input", () => {
  assert.throws(
    () => decodeSm2Sequence(Buffer.from("bad")),
    /Invalid SM2 header/
  );
  assert.throws(
    () => applyViewportScanlines(
      { width: 1, height: 1, rgba: new Uint8Array(4) },
      { viewportY: 0.5 }
    ),
    /scanline profile/
  );
});
