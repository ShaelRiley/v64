import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeCanonicalHuffman, encodeCanonicalHuffman
} from "../prototype/js/canonical-huffman.mjs";

test("canonical Huffman coding round-trips empty, singular, and full alphabets", () => {
  const fixtures = [
    Buffer.alloc(0),
    Buffer.alloc(4096, 0x5a),
    Buffer.from(Array.from({ length: 4096 }, (_, index) => index & 0xff)),
    Buffer.from("V64 deterministic canonical Huffman fixture ".repeat(200))
  ];
  for (const fixture of fixtures) {
    const encoded = encodeCanonicalHuffman(fixture);
    assert.deepEqual(decodeCanonicalHuffman(encoded), fixture);
    assert.deepEqual(encodeCanonicalHuffman(fixture), encoded);
  }
});

test("canonical Huffman decoder rejects malformed tables, lengths, and bounds", () => {
  const encoded = encodeCanonicalHuffman(Buffer.from("bounded output"));
  assert.throws(() => decodeCanonicalHuffman(encoded, { maximumOutput: 2 }), /exceeds bound/);
  assert.throws(() => decodeCanonicalHuffman(encoded.subarray(0, encoded.length - 1)), /length|Truncated/);

  const duplicate = Buffer.from(encoded);
  if (duplicate.readUInt16LE(8) >= 2) duplicate[16] = duplicate[14];
  assert.throws(() => decodeCanonicalHuffman(duplicate), /Duplicate/);

  const badMagic = Buffer.from(encoded);
  badMagic[0] ^= 0xff;
  assert.throws(() => decodeCanonicalHuffman(badMagic), /header/);
});
