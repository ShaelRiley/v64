import { basename, dirname, extname, join, resolve } from "node:path";

import {
  LIMITS,
  cadenceFromValue,
  paletteDepthFromValue
} from "../../prototype/js/constants.mjs";

export const DROP_JOB_FORMAT = "VIDEO64-DROP-JOB-1";
export const DROP_QUEUE_FORMAT = "VIDEO64-DROP-QUEUE-1";

export const DROP_STAGE_IDS = Object.freeze([
  "analysis",
  "video_encode",
  "audio_encode",
  "mux",
  "verify"
]);

export const DROP_CAPABILITIES = Object.freeze({
  desktopShell: false,
  sourceAnalysis: true,
  queue: true,
  videoEncoding: true,
  audioEncoding: true,
  particleLighting: false,
  sampledSizeEstimator: true,
  decodedPreview: true,
  outputVerification: true
});

export const DEFAULT_DROP_SETTINGS = Object.freeze({
  fps: "24",
  columns: 80,
  palette: 32,
  glyphs: 32,
  profile: "balanced"
});

const PROFILES = new Set(["smallest", "balanced", "clearest"]);
const GLYPH_COUNTS = new Set([32, 64]);
const STAGE_STATES = new Set(["pending", "running", "completed", "skipped", "failed"]);

export function normalizeDropSettings(settings = {}) {
  const cadence = cadenceFromValue(settings.fps ?? DEFAULT_DROP_SETTINGS.fps);
  const columns = Number(settings.columns ?? DEFAULT_DROP_SETTINGS.columns);
  if (!Number.isInteger(columns) || columns < 1 || columns > LIMITS.maxColumns) {
    throw new RangeError(`Columns must be an integer from 1 to ${LIMITS.maxColumns}`);
  }
  const palette = paletteDepthFromValue(
    settings.palette ?? DEFAULT_DROP_SETTINGS.palette
  ).depth;
  const glyphs = Number(settings.glyphs ?? DEFAULT_DROP_SETTINGS.glyphs);
  if (!GLYPH_COUNTS.has(glyphs)) {
    throw new RangeError("Glyph budget must be 32 or 64");
  }
  const profile = String(settings.profile ?? DEFAULT_DROP_SETTINGS.profile).toLowerCase();
  if (!PROFILES.has(profile)) {
    throw new RangeError("Profile must be smallest, balanced, or clearest");
  }
  return Object.freeze({
    fps: cadence.label,
    columns,
    palette,
    glyphs,
    profile
  });
}

export function suggestDropOutputPath(inputPath, outputDirectory = null) {
  const absolute = resolve(String(inputPath));
  const extension = extname(absolute);
  const fileName = basename(absolute, extension);
  const stem = extension.toLowerCase() === ".v64" ? `${fileName}.encoded` : fileName;
  return join(outputDirectory ? resolve(outputDirectory) : dirname(absolute), `${stem}.v64`);
}

function uniqueDropOutputPath(suggestedPath, usedPaths) {
  const absolute = resolve(suggestedPath);
  if (!usedPaths.has(absolute)) return absolute;
  const directory = dirname(absolute);
  const extension = extname(absolute) || ".v64";
  const stem = basename(absolute, extension);
  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
    const candidate = join(directory, `${stem}.${suffix}${extension}`);
    if (!usedPaths.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate a unique Video64 Drop output path");
}

function makeStages() {
  return Object.fromEntries(DROP_STAGE_IDS.map((id) => [id, {
    id,
    state: "pending",
    progress: 0,
    detail: null
  }]));
}

export function createDropJob({
  id,
  inputPath,
  outputPath = null,
  settings = {}
}) {
  if (!id) throw new TypeError("A stable job id is required");
  if (!inputPath) throw new TypeError("An input path is required");
  const input = resolve(String(inputPath));
  return {
    format: DROP_JOB_FORMAT,
    id: String(id),
    inputPath: input,
    outputPath: outputPath ? resolve(String(outputPath)) : suggestDropOutputPath(input),
    settings: normalizeDropSettings(settings),
    status: "queued",
    stages: makeStages(),
    warnings: [],
    analysis: null,
    result: null,
    error: null
  };
}

export function createDropQueue({ settings = {}, jobs = [] } = {}) {
  return {
    format: DROP_QUEUE_FORMAT,
    settings: normalizeDropSettings(settings),
    jobs: jobs.map((job) => ({ ...job }))
  };
}

export function enqueueDropInputs(queue, inputPaths, { outputDirectory = null } = {}) {
  if (queue?.format !== DROP_QUEUE_FORMAT) throw new TypeError("Invalid Video64 Drop queue");
  const existingInputs = new Set(queue.jobs.map((job) => job.inputPath));
  const usedOutputs = new Set(queue.jobs.map((job) => job.outputPath));
  const additions = [];
  for (const inputPath of inputPaths) {
    const absolute = resolve(String(inputPath));
    if (existingInputs.has(absolute)) continue;
    existingInputs.add(absolute);
    const outputPath = uniqueDropOutputPath(
      suggestDropOutputPath(absolute, outputDirectory),
      usedOutputs
    );
    usedOutputs.add(outputPath);
    additions.push(createDropJob({
      id: `drop-${String(queue.jobs.length + additions.length + 1).padStart(4, "0")}`,
      inputPath: absolute,
      outputPath,
      settings: queue.settings
    }));
  }
  return { ...queue, jobs: [...queue.jobs, ...additions] };
}

export function beginDropJob(job) {
  if (job.status !== "queued") throw new Error(`Cannot begin job in ${job.status} state`);
  return { ...job, status: "running", error: null };
}

export function updateDropStage(job, stageId, state, { progress, detail } = {}) {
  if (!DROP_STAGE_IDS.includes(stageId)) throw new RangeError(`Unknown Drop stage ${stageId}`);
  if (!STAGE_STATES.has(state)) throw new RangeError(`Unknown Drop stage state ${state}`);
  const current = job.stages[stageId];
  const nextProgress = progress ?? (
    state === "completed" || state === "skipped" ? 1 :
      state === "running" ? Math.max(current.progress, 0) : current.progress
  );
  if (!Number.isFinite(nextProgress) || nextProgress < 0 || nextProgress > 1) {
    throw new RangeError("Stage progress must be from 0 to 1");
  }
  return {
    ...job,
    stages: {
      ...job.stages,
      [stageId]: {
        ...current,
        state,
        progress: nextProgress,
        detail: detail ?? current.detail
      }
    }
  };
}

export function addDropWarning(job, warning) {
  const text = String(warning).trim();
  if (!text || job.warnings.includes(text)) return job;
  return { ...job, warnings: [...job.warnings, text] };
}

export function completeDropJob(job, result) {
  return { ...job, status: "completed", result, error: null };
}

export function failDropJob(job, error) {
  return {
    ...job,
    status: "failed",
    error: error instanceof Error ? error.message : String(error)
  };
}

export function encoderOptionsFromDropSettings(settings) {
  const normalized = normalizeDropSettings(settings);
  return {
    fps: normalized.fps,
    columns: String(normalized.columns),
    palette: String(normalized.palette),
    glyphs: String(normalized.glyphs),
    profile: normalized.profile
  };
}
