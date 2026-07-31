import { stabilizeSubtitlePlane } from "./subtitle-mask-sm4.mjs";

const MASK_ROWS = 16;

function assertInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
}

function normalizeFrames(frames, cellCount, paletteDepth) {
  if (!Array.isArray(frames) || !frames.length) {
    throw new TypeError("SM5 span stabilization requires at least one frame");
  }
  return frames.map((frame) => {
    if (!Array.isArray(frame)) throw new TypeError("SM5 frame must be an array");
    let previousCell = -1;
    return frame.map((input) => {
      if (!input || typeof input !== "object") throw new TypeError("SM5 entry must be an object");
      assertInteger(input.cellIndex, "SM5 cell index", 0, cellCount - 1);
      if (input.cellIndex <= previousCell) throw new Error("SM5 entries must be strictly row-major");
      previousCell = input.cellIndex;
      assertInteger(input.foreground, "SM5 foreground", 0, paletteDepth - 1);
      assertInteger(input.background, "SM5 background", 0, paletteDepth - 1);
      const mask = Buffer.from(input.mask || []);
      if (mask.length !== MASK_ROWS) throw new Error("SM5 entry requires sixteen mask rows");
      return { ...input, mask };
    });
  });
}

function cloneEntry(entry) {
  return { ...entry, mask: Buffer.from(entry.mask) };
}

function cellSet(frame) {
  return new Set(frame.map((entry) => entry.cellIndex));
}

function unionSet(frames, start, end) {
  const result = new Set();
  for (let index = start; index < end; index += 1) {
    for (const entry of frames[index]) result.add(entry.cellIndex);
  }
  return result;
}

function similarity(a, b) {
  if (!a.size && !b.size) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

function mergeShortSpans(spans, frames, minimumSpanFrames) {
  const output = spans.map((span) => ({ ...span }));
  while (output.length > 1) {
    const index = output.findIndex((span) => span.endFrame - span.startFrame < minimumSpanFrames);
    if (index < 0) break;
    const current = output[index];
    const currentSet = unionSet(frames, current.startFrame, current.endFrame);
    const before = index > 0 ? output[index - 1] : null;
    const after = index + 1 < output.length ? output[index + 1] : null;
    const beforeScore = before
      ? similarity(currentSet, unionSet(frames, before.startFrame, before.endFrame))
      : -1;
    const afterScore = after
      ? similarity(currentSet, unionSet(frames, after.startFrame, after.endFrame))
      : -1;
    if (before && (beforeScore >= afterScore || !after)) {
      before.endFrame = current.endFrame;
      output.splice(index, 1);
    } else {
      after.startFrame = current.startFrame;
      output.splice(index, 1);
    }
  }
  return output;
}

/**
 * Detect deterministic adjacent subtitle spans from selected-cell similarity,
 * then stabilize each span independently with SM4. Empty or very sparse frames
 * inherit their surrounding caption, and undersized spans merge toward the
 * more similar neighbor. Decoder syntax remains SM2 full/repeat/delta.
 */
export function stabilizeSubtitleSpans(frames, options) {
  const cellCount = Number(options?.cellCount);
  const paletteDepth = Number(options?.paletteDepth);
  assertInteger(cellCount, "SM5 cell count", 1, 0xffffffff);
  assertInteger(paletteDepth, "SM5 palette depth", 2, 256);
  const normalized = normalizeFrames(frames, cellCount, paletteDepth);
  const boundarySimilarity = Number(options?.boundarySimilarity ?? 0.42);
  const minimumSpanFrames = Number(options?.minimumSpanFrames ?? 2);
  const sparseFrameCells = Number(options?.sparseFrameCells ?? 2);
  if (!Number.isFinite(boundarySimilarity) || boundarySimilarity < 0 || boundarySimilarity > 1 ||
      !Number.isInteger(minimumSpanFrames) || minimumSpanFrames < 1 ||
      minimumSpanFrames > normalized.length ||
      !Number.isInteger(sparseFrameCells) || sparseFrameCells < 0) {
    throw new RangeError("Invalid SM5 span options");
  }

  const sets = normalized.map(cellSet);
  const rawSpans = [];
  let startFrame = 0;
  let reference = sets[0];
  for (let index = 1; index < normalized.length; index += 1) {
    const sparse = sets[index].size <= sparseFrameCells || reference.size <= sparseFrameCells;
    const score = similarity(reference, sets[index]);
    if (!sparse && score < boundarySimilarity && index - startFrame >= minimumSpanFrames) {
      rawSpans.push({ startFrame, endFrame: index });
      startFrame = index;
      reference = sets[index];
    } else if (sets[index].size > sparseFrameCells) {
      reference = unionSet(normalized, startFrame, index + 1);
    }
  }
  rawSpans.push({ startFrame, endFrame: normalized.length });
  const spans = mergeShortSpans(rawSpans, normalized, minimumSpanFrames);
  const outputFrames = Array(normalized.length);
  const spanDiagnostics = [];

  for (const span of spans) {
    const stabilized = stabilizeSubtitlePlane(
      normalized.slice(span.startFrame, span.endFrame),
      options
    );
    for (let index = span.startFrame; index < span.endFrame; index += 1) {
      outputFrames[index] = stabilized.plane.map(cloneEntry);
    }
    spanDiagnostics.push({
      startFrame: span.startFrame,
      endFrame: span.endFrame,
      frameCount: span.endFrame - span.startFrame,
      planeCells: stabilized.plane.length,
      sourceSelectedCells: stabilized.diagnostics.sourceSelectedCells,
      stabilizedCellFrames: stabilized.diagnostics.stabilizedCellFrames
    });
  }

  return {
    frames: outputFrames,
    spans: spanDiagnostics,
    diagnostics: {
      sourceFrames: normalized.length,
      spanCount: spanDiagnostics.length,
      boundarySimilarity,
      minimumSpanFrames,
      sparseFrameCells,
      sourceSelectedCells: normalized.reduce((sum, frame) => sum + frame.length, 0),
      stabilizedCellFrames: outputFrames.reduce((sum, frame) => sum + frame.length, 0)
    }
  };
}
