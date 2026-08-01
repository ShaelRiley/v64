import { CADENCES, LIMITS, PALETTE_DEPTHS } from "./constants.mjs";

export const CORPUS_MANIFEST_VERSION = "V64-CORPUS-MANIFEST-1";
export const STRUCTURAL_CLASSES = Object.freeze([
  "dialogue",
  "dark-cinematography",
  "rapid-motion",
  "2d-animation",
  "3d-animation",
  "black-and-white-film",
  "music-video",
  "screen-capture",
  "subtitles",
  "static-lecture",
  "highly-saturated-material"
]);

const GENERATORS = new Set([
  "dialogue-face",
  "dark-cinematography",
  "rapid-motion",
  "flat-animation",
  "depth-animation",
  "monochrome-film",
  "music-video",
  "screen-capture",
  "subtitles",
  "static-lecture",
  "saturated-material"
]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

export function validateCorpusManifest(input) {
  assertPlainObject(input, "Corpus manifest");
  if (input.format !== CORPUS_MANIFEST_VERSION) {
    throw new Error(`Unsupported corpus manifest ${input.format}`);
  }
  if (!Array.isArray(input.entries) || !input.entries.length) {
    throw new Error("Corpus manifest requires entries");
  }
  const ids = new Set();
  const classes = new Set();
  for (const entry of input.entries) {
    assertPlainObject(entry, "Corpus entry");
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(entry.id || "")) {
      throw new Error("Corpus entry has an invalid stable id");
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate corpus entry ${entry.id}`);
    ids.add(entry.id);
    if (!STRUCTURAL_CLASSES.includes(entry.structuralClass)) {
      throw new Error(`Unknown structural class ${entry.structuralClass}`);
    }
    classes.add(entry.structuralClass);
    if (!GENERATORS.has(entry.generator)) throw new Error(`Unknown fixture generator ${entry.generator}`);
    if (!Number.isInteger(entry.seed) || entry.seed < 1 || entry.seed > 0xffff_ffff) {
      throw new Error(`Invalid seed for ${entry.id}`);
    }
    assertPlainObject(entry.grid, `Grid for ${entry.id}`);
    const { columns, rows } = entry.grid;
    if (!Number.isInteger(columns) || !Number.isInteger(rows) ||
        columns < 1 || rows < 1 || columns > LIMITS.maxColumns || rows > LIMITS.maxRows ||
        columns * rows > LIMITS.maxCells) {
      throw new Error(`Invalid grid for ${entry.id}`);
    }
    if (!PALETTE_DEPTHS.includes(entry.paletteDepth)) {
      throw new Error(`Illegal palette depth for ${entry.id}`);
    }
    if (!CADENCES.some((cadence) => cadence.label === entry.cadence)) {
      throw new Error(`Illegal cadence for ${entry.id}`);
    }
    if (!Number.isInteger(entry.frames) || entry.frames < 2 || entry.frames > 3600) {
      throw new Error(`Invalid frame count for ${entry.id}`);
    }
    assertPlainObject(entry.provenance, `Provenance for ${entry.id}`);
    if (entry.provenance.license !== "CC0-1.0" ||
        entry.provenance.creator !== "V64 project" ||
        entry.provenance.method !== "deterministic cell-state generator v1") {
      throw new Error(`Unverifiable seed-corpus provenance for ${entry.id}`);
    }
  }
  const missing = STRUCTURAL_CLASSES.filter((name) => !classes.has(name));
  if (missing.length) throw new Error(`Corpus manifest lacks structural classes: ${missing.join(", ")}`);
  return structuredClone(input);
}

function makePrng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function makeFrame(columns, rows, background = 0) {
  const cells = new Uint8Array(columns * rows * 3);
  for (let cell = 0; cell < columns * rows; cell += 1) cells[cell * 3 + 2] = background;
  return cells;
}

function setCell(cells, columns, rows, x, y, glyph, foreground, background) {
  if (x < 0 || y < 0 || x >= columns || y >= rows) return;
  const offset = (y * columns + x) * 3;
  cells[offset] = glyph;
  cells[offset + 1] = foreground;
  cells[offset + 2] = background;
}

function fillRect(cells, columns, rows, x, y, width, height, token) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setCell(cells, columns, rows, column, row, token[0], token[1], token[2]);
    }
  }
}

function generateFrame(entry, frameIndex) {
  const { columns, rows } = entry.grid;
  const depth = entry.paletteDepth;
  const random = makePrng((entry.seed + frameIndex * 0x9e37_79b9) >>> 0);
  const cells = makeFrame(columns, rows, 0);
  const phase = frameIndex % entry.frames;
  const safe = (value) => ((value % depth) + depth) % depth;

  if (entry.generator === "dialogue-face" || entry.generator === "static-lecture") {
    const x = Math.floor(columns / 2) - 3 + (entry.generator === "dialogue-face" && frameIndex % 12 >= 8 ? 1 : 0);
    fillRect(cells, columns, rows, x, 1, 6, 5, [12, safe(6), safe(1)]);
    setCell(cells, columns, rows, x + 1, 2, 33, safe(1), safe(6));
    setCell(cells, columns, rows, x + 4, 2, 33, safe(1), safe(6));
    setCell(cells, columns, rows, x + 2, 4, 18 + (frameIndex % 4), safe(1), safe(6));
    setCell(cells, columns, rows, x + 3, 4, 18 + (frameIndex % 4), safe(1), safe(6));
    if (entry.generator === "static-lecture") {
      fillRect(cells, columns, rows, 2, rows - 2, columns - 4, 2, [4, safe(3), safe(1)]);
    }
  } else if (entry.generator === "dark-cinematography") {
    const x = (Math.floor(frameIndex / 3) % (columns + 6)) - 3;
    fillRect(cells, columns, rows, x, 2, 4, rows - 2, [8, 1, 0]);
    for (let y = 0; y < rows; y += 1) {
      setCell(cells, columns, rows, columns - 1 - y, y, 2, safe(2), 0);
    }
  } else if (entry.generator === "rapid-motion") {
    const x = (frameIndex * 3) % (columns + 8) - 4;
    fillRect(cells, columns, rows, x, 1, 7, rows - 2, [48 + frameIndex % 4, safe(12), safe(2)]);
    fillRect(cells, columns, rows, columns - x - 3, 3, 3, 3, [7, safe(5), safe(1)]);
  } else if (entry.generator === "flat-animation") {
    fillRect(cells, columns, rows, 1, 1, Math.floor(columns / 2), rows - 2, [1, safe(3), safe(2)]);
    const x = 3 + Math.floor((columns - 8) * (1 + Math.sin(frameIndex / 4)) / 2);
    fillRect(cells, columns, rows, x, 2, 4, 4, [32, safe(7), safe(4)]);
  } else if (entry.generator === "depth-animation") {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const band = Math.floor((x + y * 2 + frameIndex) / 3);
        setCell(cells, columns, rows, x, y, (band * 7) % 64, safe(band), safe(band + 3));
      }
    }
  } else if (entry.generator === "monochrome-film") {
    const center = Math.floor(columns / 2 + Math.sin(frameIndex / 3) * columns / 4);
    fillRect(cells, columns, rows, center - 2, 1, 5, rows - 1, [63, 1, 0]);
    for (let speck = 0; speck < 8; speck += 1) {
      setCell(
        cells, columns, rows,
        Math.floor(random() * columns), Math.floor(random() * rows),
        random() > 0.5 ? 1 : 0, 1, 0
      );
    }
  } else if (entry.generator === "music-video") {
    const scene = Math.floor(frameIndex / 6);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const pulse = (x + y + frameIndex * 2) % 6;
        setCell(cells, columns, rows, x, y, (scene * 13 + pulse * 7) % 64,
          safe(scene * 3 + pulse + 1), safe(scene * 5 + x));
      }
    }
  } else if (entry.generator === "screen-capture") {
    fillRect(cells, columns, rows, 0, 0, columns, 1, [4, safe(7), safe(1)]);
    fillRect(cells, columns, rows, 0, 1, 5, rows - 1, [1, safe(3), safe(2)]);
    for (let y = 2; y < rows - 1; y += 2) {
      for (let x = 7; x < columns - 2; x += 1) {
        setCell(cells, columns, rows, x, y, 10 + (x + y) % 20, safe(6), 0);
      }
    }
    setCell(cells, columns, rows, 7 + frameIndex % (columns - 9), 3, 63, safe(7), 0);
  } else if (entry.generator === "subtitles") {
    fillRect(cells, columns, rows, 2 + frameIndex % 6, 1, 7, 4, [14, safe(4), safe(1)]);
    const caption = Math.floor(frameIndex / 8);
    fillRect(cells, columns, rows, 2, rows - 2, columns - 4, 1, [0, safe(7), 0]);
    for (let x = 4; x < columns - 4; x += 1) {
      setCell(cells, columns, rows, x, rows - 2, 10 + (x + caption * 7) % 40, safe(7), 0);
    }
  } else if (entry.generator === "saturated-material") {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const color = safe(x * 3 + y * 5 + phase);
        setCell(cells, columns, rows, x, y, (x * 5 + y * 11 + phase) % 64,
          color, safe(color + 7));
      }
    }
  }
  return cells;
}

export function generateCorpusFixture(entryInput) {
  const manifest = {
    format: CORPUS_MANIFEST_VERSION,
    entries: STRUCTURAL_CLASSES.map((structuralClass, index) => ({
      ...entryInput,
      id: `validation-placeholder-${index}`,
      structuralClass,
      generator: [...GENERATORS][index]
    }))
  };
  const targetIndex = STRUCTURAL_CLASSES.indexOf(entryInput.structuralClass);
  if (targetIndex < 0) throw new Error(`Unknown structural class ${entryInput.structuralClass}`);
  manifest.entries[targetIndex] = entryInput;
  const validated = validateCorpusManifest(manifest);
  const entry = validated.entries[targetIndex];
  const frames = Array.from({ length: entry.frames }, (_, index) => generateFrame(entry, index));
  return { entry, frames };
}

export function generateCorpus(manifestInput) {
  const manifest = validateCorpusManifest(manifestInput);
  return {
    manifest,
    fixtures: manifest.entries.map((entry) => ({
      entry,
      frames: Array.from({ length: entry.frames }, (_, index) => generateFrame(entry, index))
    }))
  };
}
