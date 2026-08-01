const MAGIC = Buffer.from([0x53, 0x4d, 0x31, 0x00]);
const HEADER_BYTES = 16;
const MASK_ROWS = 16;
const CELL_WIDTH = 8;
const CELL_HEIGHT = 16;

function assertInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
}

function writeVarUint(value) {
  assertInteger(value, "Subtitle-mask varuint", 0, 0xffffffff);
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
    if (state.offset >= bytes.length) throw new Error("Truncated subtitle-mask varuint");
    const byte = bytes[state.offset++];
    value += (byte & 0x7f) * multiplier;
    if (!(byte & 0x80)) {
      if (!Number.isSafeInteger(value) || value > 0xffffffff) {
        throw new Error("Oversized subtitle-mask varuint");
      }
      return value;
    }
    multiplier *= 128;
  }
  throw new Error("Subtitle-mask varuint exceeds five bytes");
}

function nearestPaletteIndex(rgb, palette, depth) {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < depth; index += 1) {
    const color = palette[index];
    const dr = rgb[0] - color[0];
    const dg = rgb[1] - color[1];
    const db = rgb[2] - color[2];
    const distance = dr * dr * 0.2126 + dg * dg * 0.7152 + db * db * 0.0722;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function invertMask(mask) {
  return Buffer.from(mask, (value) => value ^ 0xff);
}

function validateMaskEntry(entry, cellCount, paletteDepth, previousCell = -1) {
  if (!entry || typeof entry !== "object") {
    throw new TypeError("Subtitle-mask entry must be an object");
  }
  assertInteger(entry.cellIndex, "Subtitle-mask cell index", 0, cellCount - 1);
  if (entry.cellIndex <= previousCell) {
    throw new Error("Subtitle-mask entries must be strictly row-major");
  }
  const mask = Buffer.from(entry.mask || []);
  if (mask.length !== MASK_ROWS) {
    throw new Error("Subtitle-mask entry requires sixteen mask rows");
  }
  assertInteger(entry.foreground, "Subtitle-mask foreground", 0, paletteDepth - 1);
  assertInteger(entry.background, "Subtitle-mask background", 0, paletteDepth - 1);
  return {
    cellIndex: entry.cellIndex,
    mask,
    foreground: entry.foreground,
    background: entry.background
  };
}

export function encodeSubtitleMaskPlane(entries, options) {
  const cellCount = Number(options?.cellCount);
  const paletteDepth = Number(options?.paletteDepth);
  assertInteger(cellCount, "Subtitle-mask cell count", 1, 0xffffffff);
  assertInteger(paletteDepth, "Subtitle-mask palette depth", 2, 256);
  if (!Array.isArray(entries)) throw new TypeError("Subtitle-mask entries must be an array");

  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(cellCount, 4);
  header.writeUInt32LE(entries.length, 8);
  header.writeUInt16LE(paletteDepth, 12);
  header.writeUInt16LE(0, 14);

  const records = [];
  let previousCell = -1;
  for (const input of entries) {
    const entry = validateMaskEntry(input, cellCount, paletteDepth, previousCell);
    const delta = entry.cellIndex - previousCell;
    if (delta <= 0) throw new Error("Subtitle-mask record made no progress");
    records.push(
      writeVarUint(delta),
      Buffer.from([entry.foreground, entry.background]),
      entry.mask
    );
    previousCell = entry.cellIndex;
  }
  return Buffer.concat([header, ...records]);
}

export function decodeSubtitleMaskPlane(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < HEADER_BYTES || !bytes.subarray(0, 4).equals(MAGIC)) {
    throw new Error("Invalid subtitle-mask plane header");
  }
  const cellCount = bytes.readUInt32LE(4);
  const entryCount = bytes.readUInt32LE(8);
  const paletteDepth = bytes.readUInt16LE(12);
  const reserved = bytes.readUInt16LE(14);
  assertInteger(cellCount, "Subtitle-mask cell count", 1, 0xffffffff);
  assertInteger(paletteDepth, "Subtitle-mask palette depth", 2, 256);
  if (reserved !== 0 || entryCount > cellCount) {
    throw new Error("Invalid subtitle-mask plane declarations");
  }

  const state = { offset: HEADER_BYTES };
  const entries = [];
  let previousCell = -1;
  for (let index = 0; index < entryCount; index += 1) {
    const delta = readVarUint(bytes, state);
    if (delta <= 0) throw new Error("Subtitle-mask record made no progress");
    const cellIndex = previousCell + delta;
    if (cellIndex < 0 || cellIndex >= cellCount || bytes.length - state.offset < 18) {
      throw new Error("Truncated or out-of-bounds subtitle-mask record");
    }
    const foreground = bytes[state.offset++];
    const background = bytes[state.offset++];
    const mask = Buffer.from(bytes.subarray(state.offset, state.offset + MASK_ROWS));
    state.offset += MASK_ROWS;
    if (foreground >= paletteDepth || background >= paletteDepth) {
      throw new Error("Subtitle-mask palette index exceeds active depth");
    }
    entries.push({ cellIndex, mask, foreground, background });
    previousCell = cellIndex;
  }
  if (state.offset !== bytes.length) throw new Error("Trailing subtitle-mask plane bytes");
  return { cellCount, paletteDepth, entries };
}

export function extractSubtitleMaskPlane(rgba, width, height, columns, rows, options = {}) {
  const bytes = Buffer.from(rgba);
  assertInteger(columns, "Subtitle-mask columns", 1, 4096);
  assertInteger(rows, "Subtitle-mask rows", 1, 4096);
  if (width !== columns * CELL_WIDTH || height !== rows * CELL_HEIGHT ||
      bytes.length !== width * height * 4) {
    throw new RangeError(
      "Subtitle-mask extraction requires exact 8x16 cell raster dimensions"
    );
  }
  const palette = options.palette;
  const paletteDepth = Number(options.paletteDepth ?? palette?.length);
  if (!Array.isArray(palette) || palette.length < paletteDepth) {
    throw new RangeError("Subtitle-mask extraction requires the active palette");
  }
  assertInteger(paletteDepth, "Subtitle-mask palette depth", 2, 256);
  const bandStart = Number(options.bandStart ?? 0.58);
  const contrastFloor = Number(options.contrastFloor ?? 36);
  if (!Number.isFinite(bandStart) || bandStart < 0 || bandStart >= 1 ||
      !Number.isFinite(contrastFloor) || contrastFloor < 0 || contrastFloor > 255) {
    throw new RangeError("Invalid subtitle-mask extraction options");
  }
  const firstRow = Math.floor(rows * bandStart);
  const entries = [];

  for (let cy = firstRow; cy < rows; cy += 1) {
    for (let cx = 0; cx < columns; cx += 1) {
      const luma = new Float32Array(128);
      const offsets = new Int32Array(128);
      let minimum = 255;
      let maximum = 0;
      let sum = 0;
      for (let py = 0; py < CELL_HEIGHT; py += 1) {
        for (let px = 0; px < CELL_WIDTH; px += 1) {
          const sample = py * CELL_WIDTH + px;
          const offset = ((cy * CELL_HEIGHT + py) * width + cx * CELL_WIDTH + px) * 4;
          const r = bytes[offset];
          const g = bytes[offset + 1];
          const b = bytes[offset + 2];
          const value = r * 0.2126 + g * 0.7152 + b * 0.0722;
          offsets[sample] = offset;
          luma[sample] = value;
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
          sum += value;
        }
      }
      if (maximum - minimum < contrastFloor) continue;

      const threshold = sum / 128;
      const brightMask = Buffer.alloc(MASK_ROWS);
      const bright = [0, 0, 0];
      const dark = [0, 0, 0];
      let brightCount = 0;
      let darkCount = 0;
      for (let py = 0; py < CELL_HEIGHT; py += 1) {
        for (let px = 0; px < CELL_WIDTH; px += 1) {
          const sample = py * CELL_WIDTH + px;
          const target = luma[sample] >= threshold ? bright : dark;
          if (target === bright) {
            brightMask[py] |= 0x80 >> px;
            brightCount += 1;
          } else {
            darkCount += 1;
          }
          const offset = offsets[sample];
          target[0] += bytes[offset];
          target[1] += bytes[offset + 1];
          target[2] += bytes[offset + 2];
        }
      }
      const minority = Math.min(brightCount, darkCount);
      if (minority < 4 || minority > 64) continue;

      const brightColor = bright.map((value) => value / Math.max(1, brightCount));
      const darkColor = dark.map((value) => value / Math.max(1, darkCount));
      const brightIsForeground = brightCount <= darkCount;
      const mask = brightIsForeground ? brightMask : invertMask(brightMask);
      const foregroundRgb = brightIsForeground ? brightColor : darkColor;
      const backgroundRgb = brightIsForeground ? darkColor : brightColor;
      entries.push({
        cellIndex: cy * columns + cx,
        mask,
        foreground: nearestPaletteIndex(foregroundRgb, palette, paletteDepth),
        background: nearestPaletteIndex(backgroundRgb, palette, paletteDepth)
      });
    }
  }
  return entries;
}

export function rasterizeSubtitleMaskPlane(decoded, columns, rows, palette) {
  const { cellCount, paletteDepth, entries } = decoded;
  if (cellCount !== columns * rows) {
    throw new RangeError("Subtitle-mask grid does not match cell count");
  }
  if (!Array.isArray(palette) || palette.length < paletteDepth) {
    throw new RangeError("Subtitle-mask palette is unavailable");
  }
  const width = columns * CELL_WIDTH;
  const height = rows * CELL_HEIGHT;
  const rgba = Buffer.alloc(width * height * 4);
  for (const entry of entries) {
    const checked = validateMaskEntry(entry, cellCount, paletteDepth);
    const cx = checked.cellIndex % columns;
    const cy = Math.floor(checked.cellIndex / columns);
    const foreground = palette[checked.foreground];
    const background = palette[checked.background];
    for (let py = 0; py < CELL_HEIGHT; py += 1) {
      for (let px = 0; px < CELL_WIDTH; px += 1) {
        const color = checked.mask[py] & (0x80 >> px) ? foreground : background;
        const offset = ((cy * CELL_HEIGHT + py) * width + cx * CELL_WIDTH + px) * 4;
        rgba[offset] = color[0];
        rgba[offset + 1] = color[1];
        rgba[offset + 2] = color[2];
        rgba[offset + 3] = 255;
      }
    }
  }
  return { width, height, rgba };
}
