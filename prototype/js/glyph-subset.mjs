import { GLYPH_MASKS } from "./assets.mjs";

const POPCOUNT = new Uint8Array(256);
for (let value = 1; value < 256; value += 1) {
  POPCOUNT[value] = POPCOUNT[value >> 1] + (value & 1);
}

function glyphDistance(left, right) {
  let distance = 0;
  for (let row = 0; row < 16; row += 1) {
    distance += POPCOUNT[GLYPH_MASKS[left][row] ^ GLYPH_MASKS[right][row]];
  }
  return distance;
}

const SUBSET_MAPS = new Map();

export function glyphSubsetMap(glyphCount) {
  if (!Number.isInteger(glyphCount) || glyphCount < 1 || glyphCount > 64) {
    throw new RangeError("Glyph subset size must be an integer from one to 64");
  }
  if (SUBSET_MAPS.has(glyphCount)) return SUBSET_MAPS.get(glyphCount);
  const map = Uint8Array.from({ length: 64 }, (_, glyph) => {
    if (glyph < glyphCount) return glyph;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < glyphCount; candidate += 1) {
      const distance = glyphDistance(glyph, candidate);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  });
  SUBSET_MAPS.set(glyphCount, map);
  return map;
}

export function remapCellsToGlyphCount(input, glyphCount) {
  const cells = Buffer.from(input);
  if (!cells.length || cells.length % 3) {
    throw new RangeError("Glyph subset remapping requires complete cell tokens");
  }
  const map = glyphSubsetMap(glyphCount);
  for (let offset = 0; offset < cells.length; offset += 3) {
    if (cells[offset] >= 64) throw new RangeError("Cell contains an invalid glyph index");
    cells[offset] = map[cells[offset]];
  }
  return cells;
}
