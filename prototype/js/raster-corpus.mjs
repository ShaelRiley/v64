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

export const RASTER_CORPUS_MANIFEST_VERSION = "V64-RASTER-CORPUS-MANIFEST-1";
const ALLOWED_LICENSES = new Set(["CC0-1.0", "CC-BY-3.0", "CC-BY-4.0", "Public-Domain"]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
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
    assertObject(entry.source, `Source for ${entry.id}`);
    if (entry.source.kind !== "local-file" ||
        typeof entry.source.path !== "string" ||
        !/^[0-9a-f]{64}$/.test(entry.source.sha256 || "") ||
        typeof entry.source.origin !== "string" ||
        !ALLOWED_LICENSES.has(entry.source.license)) {
      throw new Error(`Unverifiable raster source metadata for ${entry.id}`);
    }
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

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", args, {
    encoding: null,
    maxBuffer: 1024 * 1024 * 1024
  });
  if (result.error) throw new Error(`ffmpeg could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${result.status}): ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}

function sourceHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
  const sourcePath = resolve(baseDirectory, entry.source.path);
  const actualHash = sourceHash(sourcePath);
  if (actualHash !== entry.source.sha256) {
    throw new Error(`Raster source hash mismatch for ${entry.id}`);
  }
  const cadence = CADENCES.find((item) => item.label === entry.cadence);
  const paletteAsset = paletteAssetFromId(entry.paletteAsset);
  const proxyWidth = entry.grid.columns * 4;
  const proxyHeight = entry.grid.rows * 8;
  const raw = runFfmpeg([
    "-v", "error",
    "-i", sourcePath,
    "-t", String(entry.maximumSeconds),
    "-vf", `fps=${cadence.numerator}/${cadence.denominator},scale=${proxyWidth}:${proxyHeight}:flags=area`,
    "-an",
    "-pix_fmt", "rgba",
    "-f", "rawvideo",
    "pipe:1"
  ]);
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
      generator: "ffmpeg-raster-ingest-v1",
      paletteAsset: paletteAsset.id,
      paletteSha256: paletteAsset.sha256,
      provenance: {
        creator: entry.source.origin,
        method: "hash-validated local raster decoded through FFmpeg",
        license: entry.source.license
      }
    },
    frames,
    sourcePath,
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
      path: fixture.entry.source.path,
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
