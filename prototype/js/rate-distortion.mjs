import { analyzeRgbaFrame, renderCells } from "./video64.mjs";
import { MASTER_PALETTE } from "./assets.mjs";
import { encodeFrameCommands } from "./commands.mjs";
import { encodeCellTimeline } from "./container.mjs";
import { cadenceFromId } from "./constants.mjs";
import {
  VIDEO64_DEFAULT_GLYPH_COUNT,
  VIDEO64_STUDY_GLYPH_COUNTS,
  remapCellsToGlyphCount
} from "./glyph-subset.mjs";
import { planIndependentGroups } from "./scene-cut.mjs";

export const RATE_DISTORTION_MODES = Object.freeze({
  compact: Object.freeze({
    id: "compact",
    glyphCounts: Object.freeze([VIDEO64_DEFAULT_GLYPH_COUNT]),
    temporalStability: 0.82,
    distortionWeight: 0.75,
    sceneCutThreshold: 0.58
  }),
  balanced: Object.freeze({
    id: "balanced",
    glyphCounts: Object.freeze([VIDEO64_DEFAULT_GLYPH_COUNT]),
    temporalStability: 0.48,
    distortionWeight: 4,
    sceneCutThreshold: 0.44
  }),
  quality: Object.freeze({
    id: "quality",
    glyphCounts: Object.freeze([VIDEO64_DEFAULT_GLYPH_COUNT, 64]),
    temporalStability: 0.18,
    distortionWeight: 16,
    sceneCutThreshold: 0.34
  })
});

export function rateDistortionModeFromValue(value = "balanced") {
  const mode = RATE_DISTORTION_MODES[String(value).trim().toLowerCase()];
  if (!mode) {
    throw new RangeError(
      `Unknown rate-distortion mode ${value}; use ${Object.keys(RATE_DISTORTION_MODES).join(", ")}`
    );
  }
  return mode;
}

function assertProxy(source, width, height) {
  if (!(source instanceof Uint8Array) || source.length !== width * height * 4) {
    throw new RangeError("Rate-distortion analysis requires a complete RGBA proxy frame");
  }
}

export function measureProxyDistortion(source, width, height, rendered) {
  assertProxy(source, width, height);
  if (!rendered || rendered.width !== width * 2 || rendered.height !== height * 2 ||
      !(rendered.rgba instanceof Uint8Array)) {
    throw new RangeError("Rendered frame does not match the 2x V64 proxy geometry");
  }
  let squaredError = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (y * width + x) * 4;
      for (let oy = 0; oy < 2; oy += 1) {
        for (let ox = 0; ox < 2; ox += 1) {
          const targetOffset = (((y * 2 + oy) * rendered.width) + x * 2 + ox) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            const difference = source[sourceOffset + channel] - rendered.rgba[targetOffset + channel];
            squaredError += difference * difference;
            samples += 1;
          }
        }
      }
    }
  }
  const mse = squaredError / samples;
  return Object.freeze({
    mse: Number(mse.toFixed(6)),
    normalized: Number((mse / 65025).toFixed(9)),
    psnr: mse === 0 ? null : Number((10 * Math.log10(65025 / mse)).toFixed(6))
  });
}

export function selectRateDistortionCandidate(candidates, modeInput = "balanced") {
  const mode = typeof modeInput === "string"
    ? rateDistortionModeFromValue(modeInput)
    : modeInput;
  if (!Array.isArray(candidates) || !candidates.length) {
    throw new TypeError("Rate-distortion selection requires candidates");
  }
  const ranked = candidates.map((candidate) => {
    if (!Number.isFinite(candidate.rateBytes) || candidate.rateBytes < 0 ||
        !Number.isFinite(candidate.distortion) || candidate.distortion < 0) {
      throw new RangeError("Rate-distortion candidate metrics must be nonnegative");
    }
    const cellCount = Number(candidate.cellCount || 1);
    if (!Number.isFinite(cellCount) || cellCount <= 0) {
      throw new RangeError("Rate-distortion candidate cell count must be positive");
    }
    return {
      ...candidate,
      objective: candidate.rateBytes / cellCount +
        candidate.distortion * mode.distortionWeight
    };
  });
  ranked.sort((left, right) =>
    left.objective - right.objective ||
    left.distortion - right.distortion ||
    left.rateBytes - right.rateBytes ||
    left.glyphCount - right.glyphCount
  );
  return Object.freeze({ ...ranked[0], objective: Number(ranked[0].objective.toFixed(9)) });
}

export function analyzeRateDistortionTimeline(rawFrames, config) {
  if (!Array.isArray(rawFrames) || !rawFrames.length) {
    throw new TypeError("Rate-distortion timeline requires RGBA frames");
  }
  const mode = rateDistortionModeFromValue(config.mode);
  const { width, height, columns, rows, paletteDepth, cadenceId } = config;
  const palette = config.palette ?? MASTER_PALETTE;
  const maximumGroupFrames = Number(config.maximumGroupFrames ?? 48);
  const glyphCounts = config.glyphCounts ?? mode.glyphCounts;
  if (!Array.isArray(glyphCounts) || !glyphCounts.length ||
      glyphCounts.some((count) => !VIDEO64_STUDY_GLYPH_COUNTS.includes(count))) {
    throw new RangeError("Rate-distortion glyph candidates must use 16, 32, or 64 glyphs");
  }
  const cadence = cadenceFromId(cadenceId);
  const plan = planIndependentGroups(rawFrames, width, height, {
    threshold: config.sceneCutThreshold ?? mode.sceneCutThreshold,
    minimumGroupFrames: config.minimumGroupFrames ?? 2,
    maximumGroupFrames
  });
  const groupStarts = new Set(plan.starts);
  const frames = [];
  const selections = [];
  let prior = null;
  for (let frameIndex = 0; frameIndex < rawFrames.length; frameIndex += 1) {
    const keyframe = groupStarts.has(frameIndex);
    const analysisPrior = keyframe ? null : prior;
    const base = analyzeRgbaFrame(
      rawFrames[frameIndex], width, height, columns, rows, paletteDepth,
      analysisPrior, mode.temporalStability, palette
    );
    const candidates = glyphCounts.map((glyphCount) => {
      const state = remapCellsToGlyphCount(base, glyphCount);
      const commands = encodeFrameCommands(state, keyframe ? null : prior, {
        columns,
        rows,
        paletteDepth,
        keyframe,
        useDictionary: config.useDictionary !== false
      });
      const rendered = renderCells(state, columns, rows, paletteDepth, palette);
      const distortion = measureProxyDistortion(
        rawFrames[frameIndex], width, height, rendered
      );
      return {
        state,
        glyphCount,
        rateBytes: commands.length + 1,
        distortion: distortion.normalized,
        distortionMetrics: distortion,
        cellCount: columns * rows
      };
    });
    const selected = selectRateDistortionCandidate(candidates, mode);
    frames.push(Buffer.from(selected.state));
    selections.push(Object.freeze({
      frame: frameIndex,
      keyframe,
      glyphCount: selected.glyphCount,
      rateBytes: selected.rateBytes,
      distortion: selected.distortion,
      psnr: selected.distortionMetrics.psnr,
      objective: selected.objective
    }));
    prior = selected.state;
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return Object.freeze({
    mode: mode.id,
    defaultGlyphCount: VIDEO64_DEFAULT_GLYPH_COUNT,
    plan,
    frames: Object.freeze(frames),
    selections: Object.freeze(selections),
    metrics: Object.freeze({
      estimatedRateBytes: selections.reduce((sum, item) => sum + item.rateBytes, 0),
      meanDistortion: Number(mean(selections.map((item) => item.distortion)).toFixed(9)),
      meanPsnr: Number(mean(selections.map((item) => item.psnr ?? 99)).toFixed(6)),
      glyphSelections: Object.freeze(Object.fromEntries(
        VIDEO64_STUDY_GLYPH_COUNTS.map((count) => [
          count,
          selections.filter((item) => item.glyphCount === count).length
        ])
      )),
      independentGroups: plan.groups.length,
      sceneCuts: plan.sceneCuts
    }),
    frameTicks: cadence.frameTicks,
    encodeConfig: Object.freeze({
      columns,
      rows,
      cadenceId,
      paletteDepthId: config.paletteDepthId,
      keyframeInterval: maximumGroupFrames,
      useDictionary: config.useDictionary !== false
    })
  });
}

export function encodeSceneAwareCellTimeline(analysis) {
  const chunks = [];
  const starts = analysis.plan.starts;
  const frameTicks = Number(analysis.frameTicks);
  if (!Number.isSafeInteger(frameTicks) || frameTicks < 1) {
    throw new RangeError("Scene-aware timeline requires positive integral frame ticks");
  }
  for (let groupIndex = 0; groupIndex < starts.length; groupIndex += 1) {
    const start = starts[groupIndex];
    const end = starts[groupIndex + 1] ?? analysis.frames.length;
    const groupChunks = encodeCellTimeline(
      analysis.frames.slice(start, end),
      analysis.encodeConfig
    );
    for (const chunk of groupChunks) {
      chunks.push({
        ...chunk,
        timestamp: chunk.timestamp + start * frameTicks
      });
    }
  }
  return chunks;
}
