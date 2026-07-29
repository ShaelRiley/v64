import { GLYPH_MASKS, MASTER_PALETTE } from "./assets.mjs";

const CELL_WIDTH = 8;
const CELL_HEIGHT = 16;
const POPCOUNT = new Uint8Array(256);
for (let value = 1; value < 256; value += 1) POPCOUNT[value] = POPCOUNT[value >> 1] + (value & 1);

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function popcount32(value) {
  const n = value >>> 0;
  return POPCOUNT[n & 255] + POPCOUNT[(n >>> 8) & 255] + POPCOUNT[(n >>> 16) & 255] + POPCOUNT[(n >>> 24) & 255];
}

function orientationHistogram(values) {
  const histogram = new Float32Array(4);
  let total = 0;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const gx = values[y * 4 + Math.min(3, x + 1)] - values[y * 4 + Math.max(0, x - 1)];
      const gy = values[Math.min(7, y + 1) * 4 + x] - values[Math.max(0, y - 1) * 4 + x];
      const magnitude = Math.hypot(gx, gy);
      if (magnitude < 0.01) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;
      histogram[Math.round(angle / (Math.PI / 4)) & 3] += magnitude;
      total += magnitude;
    }
  }
  if (total) for (let index = 0; index < 4; index += 1) histogram[index] /= total;
  return histogram;
}

function featureFromValues(values, binaryMask) {
  const occupancy = new Float32Array(8);
  let count = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < 32; index += 1) {
    const amount = values[index];
    if (amount > 0) {
      const x = index & 3;
      const y = index >> 2;
      count += amount;
      weightedX += x * amount;
      weightedY += y * amount;
      occupancy[(y >> 1) * 2 + (x >> 1)] += amount * 0.25;
    }
  }
  return {
    binaryMask: binaryMask >>> 0,
    area: count / 32,
    centroidX: count ? weightedX / count / 3 : 0.5,
    centroidY: count ? weightedY / count / 7 : 0.5,
    occupancy,
    orientation: orientationHistogram(values)
  };
}

function glyphFeature(mask) {
  const values = new Float32Array(32);
  let binaryMask = 0;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      let count = 0;
      for (let oy = 0; oy < 2; oy += 1) {
        const row = mask[y * 2 + oy];
        for (let ox = 0; ox < 2; ox += 1) count += Number(Boolean(row & (0x80 >> (x * 2 + ox))));
      }
      const index = y * 4 + x;
      values[index] = count / 4;
      if (count) binaryMask = (binaryMask | (1 << index)) >>> 0;
    }
  }
  return featureFromValues(values, binaryMask);
}

const GLYPH_FEATURES = GLYPH_MASKS.map(glyphFeature);

function targetFeature(mask) {
  const values = new Float32Array(32);
  for (let index = 0; index < 32; index += 1) values[index] = (mask >>> index) & 1;
  return featureFromValues(values, mask);
}

export function scoreGlyph(target, glyphIndex) {
  const glyph = GLYPH_FEATURES[glyphIndex];
  let occupancyError = 0;
  let orientationError = 0;
  for (let index = 0; index < 8; index += 1) occupancyError += Math.abs(target.occupancy[index] - glyph.occupancy[index]);
  for (let index = 0; index < 4; index += 1) orientationError += Math.abs(target.orientation[index] - glyph.orientation[index]);
  const hamming = popcount32((target.binaryMask ^ glyph.binaryMask) >>> 0) / 32;
  const centroid = Math.abs(target.centroidX - glyph.centroidX) + Math.abs(target.centroidY - glyph.centroidY);
  return hamming * 3.2 + Math.abs(target.area - glyph.area) * 1.4 +
    occupancyError * 0.30 + centroid * 0.70 + orientationError * 0.55;
}

export function closestPaletteIndex(r, g, b, depth) {
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < depth; index += 1) {
    const color = MASTER_PALETTE[index];
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];
    const distance = dr * dr * 0.2126 + dg * dg * 0.7152 + db * db * 0.0722;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function colorDistanceSquared(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export function analyzeRgbaFrame(source, width, height, columns, rows, depth, previous = null, stability = 0.48) {
  if (source.length !== width * height * 4) throw new RangeError("RGBA frame byte length does not match dimensions");
  const cells = new Uint8Array(columns * rows * 3);
  const stable = clamp(Number(stability), 0, 1);
  const luma = new Float32Array(32);
  const offsets = new Int32Array(32);
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < columns; cx += 1) {
      let sumLuma = 0;
      let minimum = 255;
      let maximum = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (let sy = 0; sy < 8; sy += 1) {
        const sourceY = clamp(Math.floor((cy * 8 + sy + 0.5) * height / (rows * 8)), 0, height - 1);
        for (let sx = 0; sx < 4; sx += 1) {
          const sourceX = clamp(Math.floor((cx * 4 + sx + 0.5) * width / (columns * 4)), 0, width - 1);
          const index = sy * 4 + sx;
          const offset = (sourceY * width + sourceX) * 4;
          const r = source[offset];
          const g = source[offset + 1];
          const b = source[offset + 2];
          const value = r * 0.2126 + g * 0.7152 + b * 0.0722;
          offsets[index] = offset;
          luma[index] = value;
          sumLuma += value;
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
          sumR += r;
          sumG += g;
          sumB += b;
        }
      }

      const cell = cy * columns + cx;
      const tokenOffset = cell * 3;
      let glyph = 7;
      let foreground = [sumR / 32, sumG / 32, sumB / 32];
      let background = foreground;
      let brightTarget = null;
      let darkTarget = null;
      let bestScore = 0;
      if (maximum - minimum >= 7) {
        const threshold = sumLuma / 32;
        let brightMask = 0;
        let brightCount = 0;
        let darkCount = 0;
        const bright = [0, 0, 0];
        const dark = [0, 0, 0];
        for (let index = 0; index < 32; index += 1) {
          const offset = offsets[index];
          const target = luma[index] >= threshold ? bright : dark;
          if (target === bright) {
            brightMask = (brightMask | (1 << index)) >>> 0;
            brightCount += 1;
          } else darkCount += 1;
          target[0] += source[offset];
          target[1] += source[offset + 1];
          target[2] += source[offset + 2];
        }
        brightTarget = targetFeature(brightMask);
        darkTarget = targetFeature((~brightMask) >>> 0);
        let polarity = 0;
        bestScore = Infinity;
        for (let candidate = 0; candidate < 64; candidate += 1) {
          const brightScore = scoreGlyph(brightTarget, candidate);
          if (brightScore < bestScore) {
            bestScore = brightScore;
            glyph = candidate;
            polarity = 0;
          }
          const darkScore = scoreGlyph(darkTarget, candidate);
          if (darkScore < bestScore) {
            bestScore = darkScore;
            glyph = candidate;
            polarity = 1;
          }
        }
        const high = bright.map((value) => value / Math.max(1, brightCount));
        const low = dark.map((value) => value / Math.max(1, darkCount));
        foreground = polarity ? low : high;
        background = polarity ? high : low;

        if (previous) {
          const previousGlyph = previous[tokenOffset];
          const previousScore = Math.min(scoreGlyph(brightTarget, previousGlyph), scoreGlyph(darkTarget, previousGlyph));
          const keepMargin = 0.06 + stable * 0.34;
          const textureMargin = 0.22 + stable * 0.36;
          if (previousScore <= bestScore + keepMargin ||
              (glyph >= 60 && previousGlyph !== glyph && previousScore <= bestScore + textureMargin)) glyph = previousGlyph;
        }
      }

      let fg = closestPaletteIndex(foreground[0], foreground[1], foreground[2], depth);
      let bg = closestPaletteIndex(background[0], background[1], background[2], depth);
      if (previous) {
        const threshold = 7 + stable * 17;
        const previousFg = previous[tokenOffset + 1];
        const previousBg = previous[tokenOffset + 2];
        if (colorDistanceSquared(MASTER_PALETTE[fg], MASTER_PALETTE[previousFg]) <= threshold * threshold) fg = previousFg;
        if (colorDistanceSquared(MASTER_PALETTE[bg], MASTER_PALETTE[previousBg]) <= threshold * threshold) bg = previousBg;
      }
      cells[tokenOffset] = glyph;
      cells[tokenOffset + 1] = fg;
      cells[tokenOffset + 2] = bg;
    }
  }
  return cells;
}

export function renderCells(cells, columns, rows, paletteDepth = 256) {
  if (cells.length !== columns * rows * 3) throw new RangeError("Cell state length does not match grid");
  const width = columns * CELL_WIDTH;
  const height = rows * CELL_HEIGHT;
  const image = Buffer.alloc(width * height * 4);
  for (let cell = 0; cell < columns * rows; cell += 1) {
    const glyph = cells[cell * 3];
    const fgIndex = cells[cell * 3 + 1];
    const bgIndex = cells[cell * 3 + 2];
    if (glyph >= 64 || fgIndex >= paletteDepth || bgIndex >= paletteDepth) throw new RangeError(`Invalid token at cell ${cell}`);
    const foreground = MASTER_PALETTE[fgIndex];
    const background = MASTER_PALETTE[bgIndex];
    const cx = cell % columns;
    const cy = Math.floor(cell / columns);
    const mask = GLYPH_MASKS[glyph];
    for (let py = 0; py < CELL_HEIGHT; py += 1) {
      for (let px = 0; px < CELL_WIDTH; px += 1) {
        const color = mask[py] & (0x80 >> px) ? foreground : background;
        const offset = ((cy * CELL_HEIGHT + py) * width + cx * CELL_WIDTH + px) * 4;
        image[offset] = color[0];
        image[offset + 1] = color[1];
        image[offset + 2] = color[2];
        image[offset + 3] = 255;
      }
    }
  }
  return { width, height, rgba: image };
}

export function makeGlyphAtlas(scale = 2) {
  const columns = 8;
  const rows = 8;
  const cells = new Uint8Array(64 * 3);
  for (let index = 0; index < 64; index += 1) {
    cells[index * 3] = index;
    cells[index * 3 + 1] = 1;
    cells[index * 3 + 2] = 0;
  }
  const base = renderCells(cells, columns, rows, 2);
  if (scale === 1) return base;
  const width = base.width * scale;
  const height = base.height * scale;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (Math.floor(y / scale) * base.width + Math.floor(x / scale)) * 4;
      base.rgba.copy(rgba, (y * width + x) * 4, source, source + 4);
    }
  }
  return { width, height, rgba };
}

export const VIDEO64_CELL_WIDTH = CELL_WIDTH;
export const VIDEO64_CELL_HEIGHT = CELL_HEIGHT;
