import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

const MAGIC = Buffer.from([0x53, 0x4d, 0x32, 0x00]);
const HEADER_BYTES = 16;
const MASK_ROWS = 16;
const OP_REPEAT = 0x00;
const OP_FULL = 0x01;
const OP_DELTA = 0x02;

function assertInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
}

function writeVarUint(value) {
  assertInteger(value, "SM2 varuint", 0, 0xffffffff);
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}

function readVarUint(bytes, state) {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 5; count += 1) {
    if (state.offset >= bytes.length) throw new Error("Truncated SM2 varuint");
    const byte = bytes[state.offset++];
    value += (byte & 0x7f) * multiplier;
    if (!(byte & 0x80)) {
      if (!Number.isSafeInteger(value) || value > 0xffffffff) {
        throw new Error("Oversized SM2 varuint");
      }
      return value;
    }
    multiplier *= 128;
  }
  throw new Error("SM2 varuint exceeds five bytes");
}

function maskBits(mask) {
  let total = 0;
  for (const byte of mask) {
    let value = byte;
    while (value) {
      value &= value - 1;
      total += 1;
    }
  }
  return total;
}

function luma(color) {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function normalizeEntry(entry, cellCount, paletteDepth, previousCell = -1) {
  if (!entry || typeof entry !== "object") throw new TypeError("SM2 entry must be an object");
  assertInteger(entry.cellIndex, "SM2 cell index", 0, cellCount - 1);
  if (entry.cellIndex <= previousCell) throw new Error("SM2 entries must be strictly row-major");
  assertInteger(entry.foreground, "SM2 foreground", 0, paletteDepth - 1);
  assertInteger(entry.background, "SM2 background", 0, paletteDepth - 1);
  const mask = Buffer.from(entry.mask || []);
  if (mask.length !== MASK_ROWS) throw new Error("SM2 entry requires sixteen mask rows");
  return {
    cellIndex: entry.cellIndex,
    foreground: entry.foreground,
    background: entry.background,
    mask
  };
}

function normalizePlane(entries, cellCount, paletteDepth) {
  if (!Array.isArray(entries)) throw new TypeError("SM2 plane must be an array");
  const output = [];
  let previousCell = -1;
  for (const input of entries) {
    const entry = normalizeEntry(input, cellCount, paletteDepth, previousCell);
    output.push(entry);
    previousCell = entry.cellIndex;
  }
  return output;
}

function entryEqual(a, b) {
  return a.cellIndex === b.cellIndex &&
    a.foreground === b.foreground &&
    a.background === b.background &&
    a.mask.equals(b.mask);
}

function planeEqual(a, b) {
  return a.length === b.length && a.every((entry, index) => entryEqual(entry, b[index]));
}

function writeEntryRecords(entries) {
  const parts = [];
  let previousCell = -1;
  for (const entry of entries) {
    parts.push(
      writeVarUint(entry.cellIndex - previousCell),
      Buffer.from([entry.foreground, entry.background]),
      entry.mask
    );
    previousCell = entry.cellIndex;
  }
  return Buffer.concat(parts);
}

function readEntryRecords(bytes, state, count, cellCount, paletteDepth) {
  const entries = [];
  let previousCell = -1;
  for (let index = 0; index < count; index += 1) {
    const delta = readVarUint(bytes, state);
    if (delta <= 0) throw new Error("SM2 entry made no progress");
    const cellIndex = previousCell + delta;
    if (cellIndex < 0 || cellIndex >= cellCount || bytes.length - state.offset < 18) {
      throw new Error("Truncated or out-of-bounds SM2 entry");
    }
    const foreground = bytes[state.offset++];
    const background = bytes[state.offset++];
    if (foreground >= paletteDepth || background >= paletteDepth) {
      throw new Error("SM2 palette index exceeds active depth");
    }
    const mask = Buffer.from(bytes.subarray(state.offset, state.offset + MASK_ROWS));
    state.offset += MASK_ROWS;
    entries.push({ cellIndex, foreground, background, mask });
    previousCell = cellIndex;
  }
  return entries;
}

function encodeFull(plane) {
  return Buffer.concat([
    Buffer.from([OP_FULL]),
    writeVarUint(plane.length),
    writeEntryRecords(plane)
  ]);
}

function encodeDelta(previous, current) {
  const previousMap = new Map(previous.map((entry) => [entry.cellIndex, entry]));
  const currentMap = new Map(current.map((entry) => [entry.cellIndex, entry]));
  const removals = previous
    .filter((entry) => !currentMap.has(entry.cellIndex))
    .map((entry) => entry.cellIndex);
  const upserts = current.filter((entry) => {
    const before = previousMap.get(entry.cellIndex);
    return !before || !entryEqual(before, entry);
  });

  const removalParts = [];
  let previousCell = -1;
  for (const cellIndex of removals) {
    removalParts.push(writeVarUint(cellIndex - previousCell));
    previousCell = cellIndex;
  }
  return Buffer.concat([
    Buffer.from([OP_DELTA]),
    writeVarUint(removals.length),
    ...removalParts,
    writeVarUint(upserts.length),
    writeEntryRecords(upserts)
  ]);
}

export function selectSubtitleRegions(entries, columns, rows, options = {}) {
  assertInteger(columns, "SM2 columns", 1, 4096);
  assertInteger(rows, "SM2 rows", 1, 4096);
  const cellCount = columns * rows;
  const paletteDepth = Number(options.paletteDepth ?? options.palette?.length ?? 256);
  const plane = normalizePlane(entries, cellCount, paletteDepth);
  const bandStart = Number(options.bandStart ?? 0.62);
  const maxGap = Number(options.maxGap ?? 2);
  const minWidth = Number(options.minWidthCells ?? Math.max(6, Math.ceil(columns * 0.12)));
  const maxHeight = Number(options.maxHeightCells ?? Math.max(3, Math.ceil(rows * 0.18)));
  const contrastFloor = Number(options.contrastFloor ?? 72);
  if (!Number.isFinite(bandStart) || bandStart < 0 || bandStart >= 1 ||
      !Number.isInteger(maxGap) || maxGap < 0 || maxGap > 8 ||
      !Number.isInteger(minWidth) || minWidth < 1 ||
      !Number.isInteger(maxHeight) || maxHeight < 1 ||
      !Number.isFinite(contrastFloor) || contrastFloor < 0 || contrastFloor > 255) {
    throw new RangeError("Invalid SM2 region-selection options");
  }
  const firstRow = Math.floor(rows * bandStart);
  const palette = options.palette;
  const candidates = plane.filter((entry) => {
    const y = Math.floor(entry.cellIndex / columns);
    if (y < firstRow) return false;
    const ink = maskBits(entry.mask);
    if (ink < 4 || ink > 96) return false;
    if (Array.isArray(palette)) {
      const contrast = Math.abs(luma(palette[entry.foreground]) - luma(palette[entry.background]));
      if (contrast < contrastFloor) return false;
    }
    return true;
  });

  const unvisited = new Set(candidates.map((entry) => entry.cellIndex));
  const byCell = new Map(candidates.map((entry) => [entry.cellIndex, entry]));
  const selected = new Set();

  while (unvisited.size) {
    const start = unvisited.values().next().value;
    unvisited.delete(start);
    const queue = [start];
    const component = [];
    while (queue.length) {
      const cellIndex = queue.pop();
      const x = cellIndex % columns;
      const y = Math.floor(cellIndex / columns);
      component.push(byCell.get(cellIndex));
      for (const other of [...unvisited]) {
        const ox = other % columns;
        const oy = Math.floor(other / columns);
        if (Math.abs(oy - y) <= 1 && Math.abs(ox - x) <= maxGap + 1) {
          unvisited.delete(other);
          queue.push(other);
        }
      }
    }
    const xs = component.map((entry) => entry.cellIndex % columns);
    const ys = component.map((entry) => Math.floor(entry.cellIndex / columns));
    const width = Math.max(...xs) - Math.min(...xs) + 1;
    const height = Math.max(...ys) - Math.min(...ys) + 1;
    if (component.length >= 3 && width >= minWidth && height <= maxHeight) {
      for (const entry of component) selected.add(entry.cellIndex);
    }
  }

  return plane.filter((entry) => selected.has(entry.cellIndex));
}

export function encodeSubtitleMaskSequence(frames, options) {
  const cellCount = Number(options?.cellCount);
  const paletteDepth = Number(options?.paletteDepth);
  assertInteger(cellCount, "SM2 cell count", 1, 0xffffffff);
  assertInteger(paletteDepth, "SM2 palette depth", 2, 256);
  if (!Array.isArray(frames) || !frames.length) {
    throw new TypeError("SM2 sequence requires at least one frame");
  }
  const normalized = frames.map((frame) => normalizePlane(frame, cellCount, paletteDepth));
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(cellCount, 4);
  header.writeUInt32LE(normalized.length, 8);
  header.writeUInt16LE(paletteDepth, 12);
  header.writeUInt16LE(0, 14);

  const commands = [encodeFull(normalized[0])];
  let previous = normalized[0];
  for (let index = 1; index < normalized.length;) {
    if (planeEqual(previous, normalized[index])) {
      let span = 1;
      while (index + span < normalized.length &&
          planeEqual(previous, normalized[index + span])) span += 1;
      commands.push(Buffer.concat([Buffer.from([OP_REPEAT]), writeVarUint(span)]));
      index += span;
      continue;
    }
    const full = encodeFull(normalized[index]);
    const delta = encodeDelta(previous, normalized[index]);
    commands.push(delta.length < full.length ? delta : full);
    previous = normalized[index];
    index += 1;
  }
  return Buffer.concat([header, ...commands]);
}

export function decodeSubtitleMaskSequence(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < HEADER_BYTES || !bytes.subarray(0, 4).equals(MAGIC)) {
    throw new Error("Invalid SM2 sequence header");
  }
  const cellCount = bytes.readUInt32LE(4);
  const frameCount = bytes.readUInt32LE(8);
  const paletteDepth = bytes.readUInt16LE(12);
  const reserved = bytes.readUInt16LE(14);
  assertInteger(cellCount, "SM2 cell count", 1, 0xffffffff);
  assertInteger(frameCount, "SM2 frame count", 1, 0xffffffff);
  assertInteger(paletteDepth, "SM2 palette depth", 2, 256);
  if (reserved !== 0) throw new Error("Invalid SM2 reserved field");

  const state = { offset: HEADER_BYTES };
  const frames = [];
  let current = [];
  while (frames.length < frameCount) {
    if (state.offset >= bytes.length) throw new Error("Truncated SM2 command stream");
    const opcode = bytes[state.offset++];
    if (opcode === OP_REPEAT) {
      if (!frames.length) throw new Error("SM2 repeat precedes the first plane");
      const span = readVarUint(bytes, state);
      if (span < 1 || frames.length + span > frameCount) {
        throw new Error("Invalid SM2 repeat span");
      }
      for (let count = 0; count < span; count += 1) {
        frames.push(current.map((entry) => ({ ...entry, mask: Buffer.from(entry.mask) })));
      }
      continue;
    }
    if (opcode === OP_FULL) {
      const count = readVarUint(bytes, state);
      if (count > cellCount) throw new Error("SM2 full plane exceeds cell count");
      current = readEntryRecords(bytes, state, count, cellCount, paletteDepth);
      frames.push(current.map((entry) => ({ ...entry, mask: Buffer.from(entry.mask) })));
      continue;
    }
    if (opcode === OP_DELTA) {
      if (!frames.length) throw new Error("SM2 delta precedes the first plane");
      const map = new Map(current.map((entry) => [entry.cellIndex, entry]));
      const removalCount = readVarUint(bytes, state);
      let previousCell = -1;
      for (let index = 0; index < removalCount; index += 1) {
        const delta = readVarUint(bytes, state);
        if (delta <= 0) throw new Error("SM2 removal made no progress");
        const cellIndex = previousCell + delta;
        if (cellIndex < 0 || cellIndex >= cellCount || !map.delete(cellIndex)) {
          throw new Error("Invalid SM2 removal");
        }
        previousCell = cellIndex;
      }
      const upsertCount = readVarUint(bytes, state);
      const upserts = readEntryRecords(bytes, state, upsertCount, cellCount, paletteDepth);
      for (const entry of upserts) map.set(entry.cellIndex, entry);
      current = [...map.values()].sort((a, b) => a.cellIndex - b.cellIndex);
      frames.push(current.map((entry) => ({ ...entry, mask: Buffer.from(entry.mask) })));
      continue;
    }
    throw new Error(`Unknown SM2 opcode ${opcode}`);
  }
  if (state.offset !== bytes.length) throw new Error("Trailing SM2 sequence bytes");
  return { cellCount, frameCount, paletteDepth, frames };
}

export function measureSubtitleMaskSequence(frames, options) {
  const bytes = encodeSubtitleMaskSequence(frames, options);
  const decoded = decodeSubtitleMaskSequence(bytes);
  const deflateBytes = deflateRawSync(bytes, { level: 9 }).length;
  return {
    frames: decoded.frameCount,
    bytes: bytes.length,
    deflateBytes,
    bytesPerFrame: Number((bytes.length / decoded.frameCount).toFixed(3)),
    deflateBytesPerFrame: Number((deflateBytes / decoded.frameCount).toFixed(3)),
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}
