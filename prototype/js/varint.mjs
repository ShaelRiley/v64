export function encodeVarUint(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError("varuint must be a uint32");
  const bytes = [];
  let n = value >>> 0;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    bytes.push(byte);
  } while (n);
  return Buffer.from(bytes);
}

export function decodeVarUint(buffer, offset = 0) {
  let value = 0;
  let shift = 0;
  for (let index = 0; index < 5; index += 1) {
    if (offset + index >= buffer.length) throw new Error("Truncated varuint");
    const byte = buffer[offset + index];
    if (index === 4 && (byte & 0xf0)) throw new Error("Varuint exceeds uint32");
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) {
      const unsigned = value >>> 0;
      if (encodeVarUint(unsigned).length !== index + 1) throw new Error("Non-canonical varuint");
      return { value: unsigned, next: offset + index + 1 };
    }
    shift += 7;
  }
  throw new Error("Varuint exceeds five bytes");
}
