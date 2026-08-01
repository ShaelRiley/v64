import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CADENCES, LIMITS, PALETTE_DEPTHS
} from "./constants.mjs";
import { analyzeRgbaFrame } from "./video64.mjs";
import { benchmarkEntropyFixtures } from "./entropy-benchmark.mjs";
import { STRUCTURAL_CLASSES } from "./corpus-fixtures.mjs";
import {
  PALETTE_ASSET_IDS, paletteAssetFromId
} from "./palette-registry.mjs";
import {
  GENERATED_RASTER_SOURCE_IDS, generatedRasterSourceFromId
} from "./generated-raster-sources.mjs";

export const RASTER_CORPUS_MANIFEST_VERSION = "V64-RASTER-CORPUS-MANIFEST-1";
const ALLOWED_LICENSES = new Set(["CC0-1.0", "CC-BY-3.0", "CC-BY-4.0", "Public-Domain"]);
const SOURCE_KINDS = new Set(["local-file", "local-still", "generated-plate"]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function validateSource(source, entryId) {
  assertObject(source, `Source for ${entryId}`);
  if (!SOURCE_KINDS.has(source.kind) ||
      !/^[0-9a-f]{64}$/.test(source.sha256 || "") ||
      typeof source.origin !== "string" ||
      !ALLOWED_LICENSES.has(source.license)) {
    throw new Error(`Unverifiable raster source metadata for ${entryId}`);
  }
  if ((source.kind === "local-file" || source.kind === "local-still") &&
      typeof source.path !== "string") {
    throw new Error(`Raster source path is missing for ${entryId}`);
  }
  if (source.kind === "generated-plate" &&
      !GENERATED_RASTER_SOURCE_IDS.includes(source.generatorId)) {
    throw new Error(`Unknown generated raster source for ${entryId}`);
  }
  if (source.kind === "local-still" || source.kind === "generated-plate") {
    if (!Number.isFinite(source.framerate) || source.framerate <= 0 || source.framerate > 120 ||
        typeof source.videoFilter !== "string" || !source.videoFilter.trim() ||
        /[\r\n]/.test(source.videoFilter)) {
      throw new Error(`Invalid deterministic still treatment for ${entryId}`);
    }
  }
}

function validateReview(review, entryId) {
  if (review === undefined) return;
  assertObject(review, `Review metadata for ${entryId}`);
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(review.group || "") ||
      !Array.isArray(review.questions) || !review.questions.length ||
      review.questions.some((question) => typeof question !== "string" || !question.trim())) {
    throw new Error(`Invalid blind-review metadata for ${entryId}`);
  }
}

export function validateRasterCorpusManifest(input) {
  assertObject(input, "Raster corpus manifest");
  if (input.format !== RASTER_CORPUS_MANIFEST_VERSION) {
    throw new Error(`Unsupported raster corpus manifest ${input.format}`);
  }
  if (!input.id || !input.title || !input.scope) {
    throw new Error("Raster corpus metadata is incomplete");
  }
  if (!Array.isArray(input.entries) || !input.entries.length) {
    throw new Error("Raster corpus requires entries");
  }
  const ids = new Set();
  for (const entry of input.entries) {
    assertObject(entry, "Raster corpus entry");
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(entry.id || "") || ids.has(entry.id)) {
      throw new Error(`Invalid or duplicate raster entry id ${entry.id}`);
    }
    ids.add(entry.id);
    if (!STRUCTURAL_CLASSES.includes(entry.structuralClass)) {
      throw new Error(`Unknown structural class ${entry.structuralClass}`);
    }
    if (entry.coverageClasses !== undefined &&
        (!Array.isArray(entry.coverageClasses) ||
          entry.coverageClasses.some((item) => !STRUCTURAL_CLASSES.includes(item)))) {
      throw new Error(`Unknown coverage class for ${entry.id}`);
    }
    if (entry.recognizabilityTargets !== undefined &&
        (!Array.isArray(entry.recognizabilityTargets) ||
          entry.recognizabilityTargets.some((item) =>
            typeof item !== "string" || !item.trim()))) {
      throw new Error(`Invalid recognizability targets for ${entry.id}`);
    }
    validateSource(entry.source, entry.id);
    validateReview(entry.review, entry.id);
    assertObject(entry.grid, `Grid for ${entry.id}`);
    const { columns, rows } = entry.grid;
    if (!Number.isInteger(columns) || !Number.isInteger(rows) ||
        columns < 1 || rows < 1 || columns > LIMITS.maxColumns ||
        rows > LIMITS.maxRows || columns * rows > LIMITS.maxCells) {
      throw new Error(`Invalid raster grid for ${entry.id}`);
    }
    if (!PALETTE_DEPTHS.includes(entry.paletteDepth)) {
      throw new Error(`Illegal raster palette depth for ${entry.id}`);
    }
    if (entry.paletteAsset !== undefined &&
        !PALETTE_ASSET_IDS.includes(entry.paletteAsset)) {
      throw new Error(`Unknown raster palette asset for ${entry.id}`);
    }
    if (!CADENCES.some((cadence) => cadence.label === entry.cadence)) {
      throw new Error(`Illegal raster cadence for ${entry.id}`);
    }
    if (!Number.isFinite(entry.maximumSeconds) ||
        entry.maximumSeconds <= 0 || entry.maximumSeconds > 60) {
      throw new Error(`Invalid raster duration for ${entry.id}`);
    }
    if (!Number.isFinite(entry.temporalStability) ||
        entry.temporalStability < 0 || entry.temporalStability > 1) {
      throw new Error(`Invalid temporal stability for ${entry.id}`);
    }
  }
  return structuredClone(input);
}

function runFfmpeg(args, input = null) {
  const result = spawnSync("ffmpeg", args, {
    input,
    encoding: null,
    maxBuffer: 1024 * 1024 * 1024
  });
  if (result.error) throw new Error(`ffmpeg could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${result.status}): ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}

function sourceMaterial(source, baseDirectory) {
  if (source.kind === "generated-plate") {
    const generated = generatedRasterSourceFromId(source.generatorId);
    return {
      path: null,
      identity: `generated:${generated.id}`,
      bytes: generated.bytes,
      sha256: generated.sha256
    };
  }
  const path = resolve(baseDirectory, source.path);
  const bytes = readFileSync(path);
  return {
    path,
    identity: source.path,
    bytes: null,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

function sourceInputArguments(source, sourcePath) {
  if (source.kind === "generated-plate") {
    return [
      "-loop", "1",
      "-framerate", String(source.framerate),
      "-f", "image2pipe",
      "-vcodec", "ppm",
      "-i", "pipe:0"
    ];
  }
  if (source.kind === "local-still") {
    return ["-loop", "1", "-framerate", String(source.framerate), "-i", sourcePath];
  }
  return ["-i", sourcePath];
}

function sourceFilters(source) {
  return source.kind === "local-still" || source.kind === "generated-plate"
    ? [source.videoFilter]
    : [];
}

function temporalCellMetrics(frames) {
  if (frames.length < 2) {
    return {
      changedCells: 0,
      comparedCells: 0,
      changedCellPercent: 0,
      oneFrameReversions: 0,
      reversionOpportunities: 0,
      flickerReversionPercent: 0
    };
  }
  const cellCount = frames[0].length / 3;
  let changedCells = 0;
  let oneFrameReversions = 0;
  for (let frameIndex = 1; frameIndex < frames.length; frameIndex += 1) {
    const current = frames[frameIndex];
    const previous = frames[frameIndex - 1];
    const twoBack = frames[frameIndex - 2] ?? null;
    for (let cell = 0; cell < cellCount; cell += 1) {
      const offset = cell * 3;
      const changed = current[offset] !== previous[offset] ||
        current[offset + 1] !== previous[offset + 1] ||
        current[offset + 2] !== previous[offset + 2];
      if (changed) changedCells += 1;
      if (twoBack && changed &&
          current[offset] === twoBack[offset] &&
          current[offset + 1] === twoBack[offset + 1] &&
          current[offset + 2] === twoBack[offset + 2]) {
        oneFrameReversions += 1;
      }
    }
  }
  const comparedCells = cellCount * (frames.length - 1);
  const reversionOpportunities = cellCount * Math.max(0, frames.length - 2);
  return {
    changedCells,
    comparedCells,
    changedCellPercent: Number((changedCells / comparedCells * 100).toFixed(3)),
    oneFrameReversions,
    reversionOpportunities,
    flickerReversionPercent: Number((
      reversionOpportunities ? oneFrameReversions / reversionOpportunities * 100 : 0
    ).toFixed(3))
  };
}

export function analyzeRasterEntry(entry, options = {}) {
  const started = performance.now();
  const baseDirectory = resolve(options.baseDirectory || process.cwd());
  const material = sourceMaterial(entry.source, baseDirectory);
  const actualHash = material.sha256;
  if (actualHash !== entry.source.sha256) {
    throw new Error(`Raster source hash mismatch for ${entry.id}`);
  }
  const cadence = CADENCES.find((item) => item.label === entry.cadence);
  const paletteAsset = paletteAssetFromId(entry.paletteAsset);
  const proxyWidth = entry.grid.columns * 4;
  const proxyHeight = entry.grid.rows * 8;
  const filters = [
    ...sourceFilters(entry.source),
    `fps=${cadence.numerator}/${cadence.denominator}`,
    `scale=${proxyWidth}:${proxyHeight}:flags=area`
  ];
  const raw = runFfmpeg([
    "-v", "error",
    ...sourceInputArguments(entry.source, material.path),
    "-t", String(entry.maximumSeconds),
    "-vf", filters.join(","),
    "-an",
    "-pix_fmt", "rgba",
    "-f", "rawvideo",
    "pipe:1"
  ], material.bytes);
  const frameBytes = proxyWidth * proxyHeight * 4;
  if (!raw.length || raw.length % frameBytes) {
    throw new Error(`FFmpeg returned a truncated raster stream for ${entry.id}`);
  }
  const frames = [];
  let previous = null;
  for (let offset = 0; offset < raw.length; offset += frameBytes) {
    const frame = analyzeRgbaFrame(
      raw.subarray(offset, offset + frameBytes),
      proxyWidth,
      proxyHeight,
      entry.grid.columns,
      entry.grid.rows,
      entry.paletteDepth,
      previous,
      entry.temporalStability,
      paletteAsset.colors
    );
    frames.push(frame);
    previous = frame;
  }
  return {
    entry: {
      ...entry,
      generator: entry.source.kind === "generated-plate"
        ? "generated-ppm-and-ffmpeg-treatment-v1"
        : entry.source.kind === "local-still"
          ? "ffmpeg-hash-validated-still-treatment-v1"
          : "ffmpeg-raster-ingest-v1",
      paletteAsset: paletteAsset.id,
      paletteSha256: paletteAsset.sha256,
      provenance: {
        creator: entry.source.origin,
        method: entry.source.kind === "generated-plate"
          ? "hash-validated generated source plate with deterministic FFmpeg treatment"
          : entry.source.kind === "local-still"
            ? "hash-validated local source plate with deterministic FFmpeg treatment"
            : "hash-validated local raster decoded through FFmpeg",
        license: entry.source.license
      }
    },
    frames,
    sourcePath: material.path,
    sourceIdentity: material.identity,
    sourceSha256: actualHash,
    analysisMetrics: {
      milliseconds: Number((performance.now() - started).toFixed(3)),
      processMaxRssKiB: process.resourceUsage().maxRSS,
      ...temporalCellMetrics(frames)
    }
  };
}

export function benchmarkRasterCorpus(manifestInput, options = {}) {
  const manifest = validateRasterCorpusManifest(manifestInput);
  const analyzed = manifest.entries.map((entry) => analyzeRasterEntry(entry, options));
  const report = benchmarkEntropyFixtures({
    id: manifest.id,
    title: manifest.title,
    scope: manifest.scope
  }, analyzed.map(({ entry, frames }) => ({ entry, frames })), {
    groupDurationsSeconds: [0.5, 1, 2],
    measurePerformance: true,
    ...options
  });
  return {
    ...report,
    rasterSources: analyzed.map((fixture) => ({
      id: fixture.entry.id,
      kind: fixture.entry.source.kind,
      path: fixture.sourceIdentity,
      sha256: fixture.sourceSha256,
      origin: fixture.entry.source.origin,
      license: fixture.entry.source.license,
      paletteAsset: fixture.entry.paletteAsset,
      paletteSha256: fixture.entry.paletteSha256,
      analyzedFrames: fixture.frames.length,
      analysisMetrics: fixture.analysisMetrics
    }))
  };
}
