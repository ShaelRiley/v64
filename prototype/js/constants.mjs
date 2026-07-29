export const MAGIC = Buffer.from([0x56, 0x36, 0x34, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]);
export const HEADER_SIZE = 128;
export const CHUNK_HEADER_SIZE = 32;
export const TICK_RATE = 60_000;

export const CADENCES = Object.freeze([
  { id: 0, label: "0.10", numerator: 1, denominator: 10, frameTicks: 600_000 },
  { id: 1, label: "0.5", numerator: 1, denominator: 2, frameTicks: 120_000 },
  { id: 2, label: "1", numerator: 1, denominator: 1, frameTicks: 60_000 },
  { id: 3, label: "3", numerator: 3, denominator: 1, frameTicks: 20_000 },
  { id: 4, label: "6", numerator: 6, denominator: 1, frameTicks: 10_000 },
  { id: 5, label: "12", numerator: 12, denominator: 1, frameTicks: 5_000 },
  { id: 6, label: "15", numerator: 15, denominator: 1, frameTicks: 4_000 },
  { id: 7, label: "24", numerator: 24, denominator: 1, frameTicks: 2_500 },
  { id: 8, label: "30", numerator: 30, denominator: 1, frameTicks: 2_000 },
  { id: 9, label: "48", numerator: 48, denominator: 1, frameTicks: 1_250 },
  { id: 10, label: "60", numerator: 60, denominator: 1, frameTicks: 1_000 }
]);

export const PALETTE_DEPTHS = Object.freeze([2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 256]);
export const COLUMN_PRESETS = Object.freeze([40, 60, 80, 100, 120, 160, 200]);
export const DEFAULT_CADENCE_ID = 7;
export const DEFAULT_COLUMNS = 80;
export const DEFAULT_PALETTE_DEPTH = 32;

export const LIMITS = Object.freeze({
  maxColumns: 512,
  maxRows: 512,
  maxCells: 262_144,
  maxStoredChunk: 64 * 1024 * 1024,
  maxInflatedChunk: 1024 * 1024 * 1024,
  maxChunks: 10_000_000,
  maxDictionaryEntries: 64,
  maxParticleEvents: 64
});

export function cadenceFromValue(value) {
  const text = String(value).trim();
  const cadence = CADENCES.find((entry) => entry.label === text || String(entry.numerator / entry.denominator) === text);
  if (!cadence) {
    throw new RangeError(`Illegal V64 cadence "${value}". Legal values: ${CADENCES.map((entry) => entry.label).join(", ")} fps`);
  }
  return cadence;
}

export function cadenceFromId(id) {
  const cadence = CADENCES[id];
  if (!cadence || cadence.id !== id) throw new RangeError(`Illegal V64 cadence ID ${id}`);
  return cadence;
}

export function paletteDepthFromValue(value) {
  const depth = Number(value);
  const id = PALETTE_DEPTHS.indexOf(depth);
  if (id < 0) throw new RangeError(`Illegal V64 palette depth "${value}". Legal values: ${PALETTE_DEPTHS.join(", ")}`);
  return { id, depth };
}

export function paletteDepthFromId(id) {
  const depth = PALETTE_DEPTHS[id];
  if (!depth) throw new RangeError(`Illegal V64 palette-depth ID ${id}`);
  return { id, depth };
}

export function deriveRows(columns, aspectRatio) {
  const c = Number(columns);
  if (!Number.isInteger(c) || c < 1 || c > LIMITS.maxColumns) throw new RangeError(`Columns must be an integer from 1 to ${LIMITS.maxColumns}`);
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) throw new RangeError("Source aspect ratio must be positive");
  const rows = Math.max(1, Math.round(c / aspectRatio / 2));
  if (rows > LIMITS.maxRows || c * rows > LIMITS.maxCells) throw new RangeError("Derived grid exceeds the V64 proof profile limits");
  return rows;
}

export function bitsPerIndex(cardinality) {
  return Math.ceil(Math.log2(cardinality));
}
