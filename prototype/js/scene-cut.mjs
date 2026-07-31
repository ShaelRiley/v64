const DEFAULTS = Object.freeze({
  threshold: 0.42,
  changedPixelThreshold: 32,
  minimumGroupFrames: 2,
  maximumGroupFrames: 48,
  sampleStride: 1
});

function clamp(value, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function assertFrame(frame, width, height, label) {
  if (!(frame instanceof Uint8Array) || frame.length !== width * height * 4) {
    throw new RangeError(`${label} must be a complete RGBA frame`);
  }
}

export function normalizeSceneCutOptions(options = {}) {
  const normalized = {
    threshold: Number(options.threshold ?? DEFAULTS.threshold),
    changedPixelThreshold: Number(
      options.changedPixelThreshold ?? DEFAULTS.changedPixelThreshold
    ),
    minimumGroupFrames: Number(
      options.minimumGroupFrames ?? DEFAULTS.minimumGroupFrames
    ),
    maximumGroupFrames: Number(
      options.maximumGroupFrames ?? DEFAULTS.maximumGroupFrames
    ),
    sampleStride: Number(options.sampleStride ?? DEFAULTS.sampleStride)
  };
  if (!Number.isFinite(normalized.threshold) ||
      normalized.threshold <= 0 || normalized.threshold > 1) {
    throw new RangeError("Scene-cut threshold must be greater than zero and at most one");
  }
  if (!Number.isFinite(normalized.changedPixelThreshold) ||
      normalized.changedPixelThreshold < 0 || normalized.changedPixelThreshold > 255) {
    throw new RangeError("Scene-cut changed-pixel threshold must be from zero to 255");
  }
  for (const name of ["minimumGroupFrames", "maximumGroupFrames", "sampleStride"]) {
    if (!Number.isInteger(normalized[name]) || normalized[name] < 1) {
      throw new RangeError(`Scene-cut ${name} must be a positive integer`);
    }
  }
  if (normalized.minimumGroupFrames > normalized.maximumGroupFrames) {
    throw new RangeError("Scene-cut minimum group exceeds maximum group");
  }
  return Object.freeze(normalized);
}

export function scoreSceneCut(previous, current, width, height, options = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("Scene-cut dimensions must be positive integers");
  }
  assertFrame(previous, width, height, "Previous scene-cut frame");
  assertFrame(current, width, height, "Current scene-cut frame");
  const normalized = normalizeSceneCutOptions(options);
  let absoluteColorDifference = 0;
  let changedPixels = 0;
  let previousLuma = 0;
  let currentLuma = 0;
  let samples = 0;
  for (let pixel = 0; pixel < width * height; pixel += normalized.sampleStride) {
    const offset = pixel * 4;
    const pr = previous[offset];
    const pg = previous[offset + 1];
    const pb = previous[offset + 2];
    const cr = current[offset];
    const cg = current[offset + 1];
    const cb = current[offset + 2];
    absoluteColorDifference += (
      Math.abs(pr - cr) * 0.2126 +
      Math.abs(pg - cg) * 0.7152 +
      Math.abs(pb - cb) * 0.0722
    );
    const priorY = pr * 0.2126 + pg * 0.7152 + pb * 0.0722;
    const currentY = cr * 0.2126 + cg * 0.7152 + cb * 0.0722;
    previousLuma += priorY;
    currentLuma += currentY;
    if (Math.abs(priorY - currentY) >= normalized.changedPixelThreshold) {
      changedPixels += 1;
    }
    samples += 1;
  }
  const meanAbsoluteDifference = absoluteColorDifference / (samples * 255);
  const changedPixelFraction = changedPixels / samples;
  const meanLumaShift = Math.abs(previousLuma - currentLuma) / (samples * 255);
  const score = clamp(
    meanAbsoluteDifference * 0.55 +
    changedPixelFraction * 0.30 +
    meanLumaShift * 0.15
  );
  return Object.freeze({
    score: Number(score.toFixed(6)),
    meanAbsoluteDifference: Number(meanAbsoluteDifference.toFixed(6)),
    changedPixelFraction: Number(changedPixelFraction.toFixed(6)),
    meanLumaShift: Number(meanLumaShift.toFixed(6)),
    samples
  });
}

export function planIndependentGroups(frames, width, height, options = {}) {
  if (!Array.isArray(frames) || !frames.length) {
    throw new TypeError("Scene-cut planning requires at least one RGBA frame");
  }
  const normalized = normalizeSceneCutOptions(options);
  for (let index = 0; index < frames.length; index += 1) {
    assertFrame(frames[index], width, height, `Scene-cut frame ${index}`);
  }
  const starts = [0];
  const decisions = [{ frame: 0, reason: "initial", score: null }];
  let groupStart = 0;
  for (let frame = 1; frame < frames.length; frame += 1) {
    const elapsed = frame - groupStart;
    const scored = scoreSceneCut(frames[frame - 1], frames[frame], width, height, normalized);
    const maximumReached = elapsed >= normalized.maximumGroupFrames;
    const sceneReached = elapsed >= normalized.minimumGroupFrames &&
      scored.score >= normalized.threshold;
    if (!maximumReached && !sceneReached) continue;
    starts.push(frame);
    decisions.push({
      frame,
      reason: maximumReached ? "maximum" : "scene-cut",
      score: scored.score
    });
    groupStart = frame;
  }
  const groups = starts.map((start, index) => ({
    start,
    end: starts[index + 1] ?? frames.length,
    frames: (starts[index + 1] ?? frames.length) - start,
    reason: decisions[index].reason,
    score: decisions[index].score
  }));
  if (groups.some((group) => group.frames < 1 ||
      group.frames > normalized.maximumGroupFrames)) {
    throw new Error("Scene-cut planner emitted an invalid independent group");
  }
  return Object.freeze({
    options: normalized,
    starts: Object.freeze(starts),
    decisions: Object.freeze(decisions.map(Object.freeze)),
    groups: Object.freeze(groups.map(Object.freeze)),
    sceneCuts: decisions.filter((item) => item.reason === "scene-cut").length,
    maximumBoundaries: decisions.filter((item) => item.reason === "maximum").length
  });
}

export const SCENE_CUT_DEFAULTS = DEFAULTS;
