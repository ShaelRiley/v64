const MASK_ROWS = 16;

function assertInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
}

function normalizeFrames(frames, cellCount, paletteDepth) {
  if (!Array.isArray(frames) || !frames.length) {
    throw new TypeError("SM4 stabilization requires at least one frame");
  }
  return frames.map((frame) => {
    if (!Array.isArray(frame)) throw new TypeError("SM4 frame must be an array");
    const output = [];
    let previousCell = -1;
    for (const input of frame) {
      if (!input || typeof input !== "object") throw new TypeError("SM4 entry must be an object");
      assertInteger(input.cellIndex, "SM4 cell index", 0, cellCount - 1);
      if (input.cellIndex <= previousCell) throw new Error("SM4 entries must be strictly row-major");
      assertInteger(input.foreground, "SM4 foreground", 0, paletteDepth - 1);
      assertInteger(input.background, "SM4 background", 0, paletteDepth - 1);
      const mask = Buffer.from(input.mask || []);
      if (mask.length !== MASK_ROWS) throw new Error("SM4 entry requires sixteen mask rows");
      output.push({
        cellIndex: input.cellIndex,
        foreground: input.foreground,
        background: input.background,
        mask
      });
      previousCell = input.cellIndex;
    }
    return output;
  });
}

function tupleKey(entry) {
  return `${entry.foreground},${entry.background}`;
}

function modalPalettePair(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = tupleKey(entry);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const [key] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const [foreground, background] = key.split(",").map(Number);
  return { foreground, background };
}

function consensusMask(entries, bitThreshold) {
  const mask = Buffer.alloc(MASK_ROWS);
  for (let row = 0; row < MASK_ROWS; row += 1) {
    for (let bit = 0; bit < 8; bit += 1) {
      const flag = 0x80 >> bit;
      const support = entries.reduce((count, entry) =>
        count + (entry.mask[row] & flag ? 1 : 0), 0);
      if (support / entries.length >= bitThreshold) mask[row] |= flag;
    }
  }
  return mask;
}

function maskBitCount(mask) {
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

function cloneEntry(entry) {
  return { ...entry, mask: Buffer.from(entry.mask) };
}

/**
 * Convert a spatially selected subtitle sequence into one canonical persistent
 * plane. Cells must recur in a bounded fraction of frames; each retained cell
 * uses a modal palette pair and a bitwise consensus mask. The returned sequence
 * repeats the same immutable plane, allowing SM2's repeat-span opcode to carry
 * stable subtitles at negligible temporal overhead.
 */
export function stabilizeSubtitlePlane(frames, options) {
  const cellCount = Number(options?.cellCount);
  const paletteDepth = Number(options?.paletteDepth);
  assertInteger(cellCount, "SM4 cell count", 1, 0xffffffff);
  assertInteger(paletteDepth, "SM4 palette depth", 2, 256);
  const normalized = normalizeFrames(frames, cellCount, paletteDepth);
  const minimumFrameFraction = Number(options?.minimumFrameFraction ?? 0.25);
  const bitThreshold = Number(options?.bitThreshold ?? 0.35);
  const minimumMaskBits = Number(options?.minimumMaskBits ?? 3);
  const maximumMaskBits = Number(options?.maximumMaskBits ?? 112);
  if (!Number.isFinite(minimumFrameFraction) || minimumFrameFraction <= 0 ||
      minimumFrameFraction > 1 ||
      !Number.isFinite(bitThreshold) || bitThreshold <= 0 || bitThreshold > 1 ||
      !Number.isInteger(minimumMaskBits) || minimumMaskBits < 1 ||
      !Number.isInteger(maximumMaskBits) || maximumMaskBits < minimumMaskBits ||
      maximumMaskBits > 128) {
    throw new RangeError("Invalid SM4 stabilization options");
  }

  const byCell = new Map();
  for (const frame of normalized) {
    for (const entry of frame) {
      if (!byCell.has(entry.cellIndex)) byCell.set(entry.cellIndex, []);
      byCell.get(entry.cellIndex).push(entry);
    }
  }
  const minimumFrames = Math.max(1, Math.ceil(normalized.length * minimumFrameFraction));
  const plane = [];
  for (const [cellIndex, entries] of [...byCell.entries()].sort((a, b) => a[0] - b[0])) {
    if (entries.length < minimumFrames) continue;
    const colors = modalPalettePair(entries);
    const mask = consensusMask(entries, bitThreshold);
    const bits = maskBitCount(mask);
    if (bits < minimumMaskBits || bits > maximumMaskBits) continue;
    plane.push({ cellIndex, ...colors, mask });
  }

  const stabilizedFrames = Array.from({ length: normalized.length }, () =>
    plane.map(cloneEntry));
  return {
    plane: plane.map(cloneEntry),
    frames: stabilizedFrames,
    diagnostics: {
      sourceFrames: normalized.length,
      sourceSelectedCells: normalized.reduce((sum, frame) => sum + frame.length, 0),
      candidateCells: byCell.size,
      minimumFrames,
      minimumFrameFraction,
      bitThreshold,
      stabilizedCells: plane.length,
      stabilizedCellFrames: plane.length * normalized.length
    }
  };
}
