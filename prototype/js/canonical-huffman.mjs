const MAGIC = Buffer.from("HUF1", "ascii");
const FIXED_HEADER_BYTES = 14;
const MAX_CODE_BITS = 32;

function buildCodeLengths(input) {
  const frequencies = new Uint32Array(256);
  for (const value of input) frequencies[value] += 1;
  const nodes = [];
  let serial = 0;
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    if (frequencies[symbol]) {
      nodes.push({
        frequency: frequencies[symbol],
        minimumSymbol: symbol,
        symbol,
        left: null,
        right: null,
        serial: serial++
      });
    }
  }
  if (!nodes.length) return new Map();
  if (nodes.length === 1) return new Map([[nodes[0].symbol, 1]]);
  const order = (a, b) =>
    a.frequency - b.frequency ||
    a.minimumSymbol - b.minimumSymbol ||
    a.serial - b.serial;
  while (nodes.length > 1) {
    nodes.sort(order);
    const left = nodes.shift();
    const right = nodes.shift();
    nodes.push({
      frequency: left.frequency + right.frequency,
      minimumSymbol: Math.min(left.minimumSymbol, right.minimumSymbol),
      symbol: null,
      left,
      right,
      serial: serial++
    });
  }
  const lengths = new Map();
  const visit = (node, depth) => {
    if (node.symbol !== null) {
      if (depth > MAX_CODE_BITS) throw new Error(`Canonical Huffman code exceeds ${MAX_CODE_BITS}-bit experimental bound`);
      lengths.set(node.symbol, depth);
      return;
    }
    visit(node.left, depth + 1);
    visit(node.right, depth + 1);
  };
  visit(nodes[0], 0);
  return lengths;
}

function canonicalCodes(lengths) {
  const ordered = [...lengths.entries()]
    .map(([symbol, length]) => ({ symbol, length }))
    .sort((a, b) => a.length - b.length || a.symbol - b.symbol);
  const codes = new Map();
  let code = 0n;
  let previousLength = 0;
  for (const entry of ordered) {
    if (!Number.isInteger(entry.length) || entry.length < 1 || entry.length > MAX_CODE_BITS) {
      throw new Error("Invalid canonical Huffman code length");
    }
    code <<= BigInt(entry.length - previousLength);
    if (code >= (1n << BigInt(entry.length))) throw new Error("Oversubscribed canonical Huffman table");
    codes.set(entry.symbol, { code, length: entry.length });
    code += 1n;
    previousLength = entry.length;
  }
  return { codes, ordered };
}

function setBit(output, bitOffset) {
  output[bitOffset >> 3] |= 1 << (7 - (bitOffset & 7));
}

function getBit(input, bitOffset) {
  return (input[bitOffset >> 3] >> (7 - (bitOffset & 7))) & 1;
}

export function encodeCanonicalHuffman(inputBuffer) {
  const input = Buffer.from(inputBuffer);
  if (input.length > 0xffff_ffff) throw new RangeError("Huffman input exceeds uint32");
  const lengths = buildCodeLengths(input);
  const { codes, ordered } = canonicalCodes(lengths);
  let bitLength = 0;
  for (const value of input) bitLength += codes.get(value).length;
  if (!Number.isSafeInteger(bitLength) || bitLength > 0xffff_ffff) {
    throw new RangeError("Huffman payload exceeds uint32 bit length");
  }
  const payload = Buffer.alloc(Math.ceil(bitLength / 8));
  let bitOffset = 0;
  for (const value of input) {
    const entry = codes.get(value);
    for (let bit = entry.length - 1; bit >= 0; bit -= 1) {
      if ((entry.code >> BigInt(bit)) & 1n) setBit(payload, bitOffset);
      bitOffset += 1;
    }
  }
  const header = Buffer.alloc(FIXED_HEADER_BYTES + ordered.length * 2);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(input.length, 4);
  header.writeUInt16LE(ordered.length, 8);
  header.writeUInt32LE(bitLength, 10);
  let offset = FIXED_HEADER_BYTES;
  for (const entry of [...ordered].sort((a, b) => a.symbol - b.symbol)) {
    header[offset++] = entry.symbol;
    header[offset++] = entry.length;
  }
  return Buffer.concat([header, payload]);
}

export function decodeCanonicalHuffman(inputBuffer, options = {}) {
  const input = Buffer.from(inputBuffer);
  if (input.length < FIXED_HEADER_BYTES || !input.subarray(0, 4).equals(MAGIC)) {
    throw new Error("Invalid canonical Huffman header");
  }
  const outputLength = input.readUInt32LE(4);
  const symbolCount = input.readUInt16LE(8);
  const bitLength = input.readUInt32LE(10);
  const maximumOutput = options.maximumOutput ?? 64 * 1024 * 1024;
  if (outputLength > maximumOutput) throw new Error("Canonical Huffman output exceeds bound");
  if (symbolCount > 256) throw new Error("Canonical Huffman symbol count exceeds alphabet");
  const payloadOffset = FIXED_HEADER_BYTES + symbolCount * 2;
  const payloadBytes = Math.ceil(bitLength / 8);
  if (payloadOffset + payloadBytes !== input.length) throw new Error("Canonical Huffman length mismatch");
  const lengths = new Map();
  for (let offset = FIXED_HEADER_BYTES; offset < payloadOffset; offset += 2) {
    const symbol = input[offset];
    const length = input[offset + 1];
    if (lengths.has(symbol)) throw new Error("Duplicate canonical Huffman symbol");
    lengths.set(symbol, length);
  }
  if (!outputLength) {
    if (symbolCount || bitLength) throw new Error("Nonempty Huffman table for empty output");
    return Buffer.alloc(0);
  }
  if (!symbolCount || !bitLength) throw new Error("Empty Huffman table for nonempty output");
  const { codes } = canonicalCodes(lengths);
  const decode = new Map();
  let maximumLength = 0;
  for (const [symbol, entry] of codes) {
    decode.set(`${entry.length}:${entry.code}`, symbol);
    maximumLength = Math.max(maximumLength, entry.length);
  }
  const payload = input.subarray(payloadOffset);
  const output = Buffer.alloc(outputLength);
  let outputOffset = 0;
  let bitOffset = 0;
  while (outputOffset < output.length) {
    let code = 0n;
    let matched = false;
    for (let length = 1; length <= maximumLength; length += 1) {
      if (bitOffset >= bitLength) throw new Error("Truncated canonical Huffman payload");
      code = (code << 1n) | BigInt(getBit(payload, bitOffset++));
      const symbol = decode.get(`${length}:${code}`);
      if (symbol !== undefined) {
        output[outputOffset++] = symbol;
        matched = true;
        break;
      }
    }
    if (!matched) throw new Error("Invalid canonical Huffman code");
  }
  if (bitOffset !== bitLength) throw new Error("Trailing canonical Huffman bits");
  for (let bit = bitLength; bit < payload.length * 8; bit += 1) {
    if (getBit(payload, bit)) throw new Error("Nonzero canonical Huffman padding bits");
  }
  return output;
}

export const CANONICAL_HUFFMAN = Object.freeze({
  magic: "HUF1",
  fixedHeaderBytes: FIXED_HEADER_BYTES,
  maximumCodeBits: MAX_CODE_BITS
});
