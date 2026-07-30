import { selectSubtitleRegions } from "./subtitle-mask-sm2.mjs";

const MASK_ROWS = 16;

function assertInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
}

function normalizeFrame(entries, cellCount, paletteDepth) {
  if (!Array.isArray(entries)) throw new TypeError("SM3 frame must be an array");
  const output = [];
  let previousCell = -1;
  for (const input of entries) {
    if (!input || typeof input !== "object") throw new TypeError("SM3 entry must be an object");
    assertInteger(input.cellIndex, "SM3 cell index", 0, cellCount - 1);
    if (input.cellIndex <= previousCell) throw new Error("SM3 entries must be strictly row-major");
    assertInteger(input.foreground, "SM3 foreground", 0, paletteDepth - 1);
    assertInteger(input.background, "SM3 background", 0, paletteDepth - 1);
    const mask = Buffer.from(input.mask || []);
    if (mask.length !== MASK_ROWS) throw new Error("SM3 entry requires sixteen mask rows");
    output.push({
      cellIndex: input.cellIndex,
      foreground: input.foreground,
      background: input.background,
      mask
    });
    previousCell = input.cellIndex;
  }
  return output;
}

function connectedComponents(cells, columns, maxGap) {
  const unvisited = new Set(cells);
  const components = [];
  while (unvisited.size) {
    const start = unvisited.values().next().value;
    unvisited.delete(start);
    const queue = [start];
    const component = [];
    while (queue.length) {
      const cellIndex = queue.pop();
      component.push(cellIndex);
      const x = cellIndex % columns;
      const y = Math.floor(cellIndex / columns);
      for (const other of [...unvisited]) {
        const ox = other % columns;
        const oy = Math.floor(other / columns);
        if (Math.abs(oy - y) <= 1 && Math.abs(ox - x) <= maxGap + 1) {
          unvisited.delete(other);
          queue.push(other);
        }
      }
    }
    components.push(component.sort((a, b) => a - b));
  }
  return components;
}

function componentBox(component, columns, rows, expansionX, expansionY) {
  const xs = component.map((cellIndex) => cellIndex % columns);
  const ys = component.map((cellIndex) => Math.floor(cellIndex / columns));
  return {
    minX: Math.max(0, Math.min(...xs) - expansionX),
    maxX: Math.min(columns - 1, Math.max(...xs) + expansionX),
    minY: Math.max(0, Math.min(...ys) - expansionY),
    maxY: Math.min(rows - 1, Math.max(...ys) + expansionY)
  };
}

function insideBox(cellIndex, box, columns) {
  const x = cellIndex % columns;
  const y = Math.floor(cellIndex / columns);
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

function cloneEntry(entry) {
  return { ...entry, mask: Buffer.from(entry.mask) };
}

/**
 * Aggregate subtitle-line evidence across a short sequence, then use the
 * persistent line boxes as a bounded fallback when the per-frame SM2 selector
 * is implausibly sparse. The SM2 sequence syntax remains unchanged.
 */
export function selectSubtitleRegionsTemporally(frames, columns, rows, options = {}) {
  assertInteger(columns, "SM3 columns", 1, 4096);
  assertInteger(rows, "SM3 rows", 1, 4096);
  if (!Array.isArray(frames) || !frames.length) {
    throw new TypeError("SM3 temporal selection requires at least one frame");
  }
  const paletteDepth = Number(options.paletteDepth ?? options.palette?.length ?? 256);
  assertInteger(paletteDepth, "SM3 palette depth", 2, 256);
  const cellCount = columns * rows;
  const normalized = frames.map((frame) => normalizeFrame(frame, cellCount, paletteDepth));

  const bandStart = Number(options.bandStart ?? 0.62);
  const firstRow = Math.floor(rows * bandStart);
  const persistenceFrames = Number(
    options.persistenceFrames ?? Math.max(2, Math.ceil(normalized.length * 0.125))
  );
  const temporalGap = Number(options.temporalGap ?? 3);
  const minWidth = Number(options.minWidthCells ?? Math.max(6, Math.ceil(columns * 0.12)));
  const maxHeight = Number(options.maxHeightCells ?? Math.max(3, Math.ceil(rows * 0.18)));
  const maxComponents = Number(options.maxComponents ?? 2);
  const expansionX = Number(options.expansionX ?? 1);
  const expansionY = Number(options.expansionY ?? 0);
  const sparseFloor = Number(options.sparseFloor ?? Math.max(8, Math.ceil(columns * 0.14)));
  const maxCellsPerFrame = Number(options.maxCellsPerFrame ?? Math.ceil(columns * 2));
  if (!Number.isFinite(bandStart) || bandStart < 0 || bandStart >= 1 ||
      !Number.isInteger(persistenceFrames) || persistenceFrames < 1 ||
      persistenceFrames > normalized.length ||
      !Number.isInteger(temporalGap) || temporalGap < 0 || temporalGap > 8 ||
      !Number.isInteger(minWidth) || minWidth < 1 ||
      !Number.isInteger(maxHeight) || maxHeight < 1 ||
      !Number.isInteger(maxComponents) || maxComponents < 1 || maxComponents > 4 ||
      !Number.isInteger(expansionX) || expansionX < 0 || expansionX > 8 ||
      !Number.isInteger(expansionY) || expansionY < 0 || expansionY > 2 ||
      !Number.isInteger(sparseFloor) || sparseFloor < 1 ||
      !Number.isInteger(maxCellsPerFrame) || maxCellsPerFrame < sparseFloor) {
    throw new RangeError("Invalid SM3 temporal-selection options");
  }

  const support = new Map();
  for (const frame of normalized) {
    for (const entry of frame) {
      const y = Math.floor(entry.cellIndex / columns);
      if (y < firstRow) continue;
      support.set(entry.cellIndex, (support.get(entry.cellIndex) || 0) + 1);
    }
  }
  const persistentCells = [...support.entries()]
    .filter(([, count]) => count >= persistenceFrames)
    .map(([cellIndex]) => cellIndex);

  const candidates = connectedComponents(persistentCells, columns, temporalGap)
    .map((component) => {
      const xs = component.map((cellIndex) => cellIndex % columns);
      const ys = component.map((cellIndex) => Math.floor(cellIndex / columns));
      const width = Math.max(...xs) - Math.min(...xs) + 1;
      const height = Math.max(...ys) - Math.min(...ys) + 1;
      const totalSupport = component.reduce((sum, cellIndex) => sum + support.get(cellIndex), 0);
      const bottomWeight = 1 + Math.max(...ys) / Math.max(1, rows - 1);
      return {
        component,
        width,
        height,
        totalSupport,
        score: totalSupport * width * bottomWeight / Math.max(1, height)
      };
    })
    .filter((item) => item.component.length >= 3 &&
      item.width >= minWidth && item.height <= maxHeight)
    .sort((a, b) => b.score - a.score || b.width - a.width ||
      a.component[0] - b.component[0])
    .slice(0, maxComponents);

  const boxes = candidates.map((item) => ({
    ...componentBox(item.component, columns, rows, expansionX, expansionY),
    score: item.score,
    persistentCells: item.component.length,
    totalSupport: item.totalSupport
  }));

  const selectedFrames = normalized.map((frame) => {
    const staticSelection = selectSubtitleRegions(frame, columns, rows, options);
    if (!boxes.length || staticSelection.length >= sparseFloor) {
      return staticSelection.map(cloneEntry);
    }

    const selected = new Map(staticSelection.map((entry) => [entry.cellIndex, entry]));
    const fallback = frame
      .filter((entry) => boxes.some((box) => insideBox(entry.cellIndex, box, columns)))
      .sort((a, b) => {
        const supportDelta = (support.get(b.cellIndex) || 0) - (support.get(a.cellIndex) || 0);
        return supportDelta || a.cellIndex - b.cellIndex;
      });
    for (const entry of fallback) {
      if (selected.size >= maxCellsPerFrame) break;
      selected.set(entry.cellIndex, entry);
    }
    return [...selected.values()].sort((a, b) => a.cellIndex - b.cellIndex).map(cloneEntry);
  });

  return {
    frames: selectedFrames,
    diagnostics: {
      sourceFrames: normalized.length,
      persistentCells: persistentCells.length,
      persistenceFrames,
      boxes,
      staticSelectedCells: normalized.reduce((sum, frame) =>
        sum + selectSubtitleRegions(frame, columns, rows, options).length, 0),
      temporalSelectedCells: selectedFrames.reduce((sum, frame) => sum + frame.length, 0),
      fallbackFrames: selectedFrames.reduce((count, frame, index) =>
        count + (frame.length > selectSubtitleRegions(normalized[index], columns, rows, options).length ? 1 : 0), 0)
    }
  };
}
