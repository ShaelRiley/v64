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

export function analyzeRasterEntry(entry, options = {}) {
  const baseDirectory = resolve(options.baseDirectory || process.cwd());
  const sourcePath = resolve(baseDirectory, entry.source.path);
  const actualHash = sourceHash(sourcePath);
  if (actualHash !== entry.source.sha256) {
    throw new Error(`Raster source hash mismatch for ${entry.id}`);
  }
  const cadence = CADENCES.find((item) => item.label === entry.cadence);
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
      entry.temporalStability
    );
    frames.push(frame);
    previous = frame;
  }
  return {
    entry: {
      ...entry,
      generator: "ffmpeg-raster-ingest-v1",
      provenance: {
        creator: entry.source.origin,
        method: "hash-validated local raster decoded through FFmpeg",
        license: entry.source.license
      }
    },
    frames,
    sourcePath,
    sourceSha256: actualHash
  };
}

export function benchmarkRasterCorpus(manifestInput, options = {}) {
  const manifest = validateRasterCorpusManifest(manifestInput);
  const analyzed = manifest.entries.map((entry) => analyzeRasterEntry(entry, options));
  const report = benchmarkEntropyFixtures({
    id: manifest.id,
    title: manifest.title,
    scope: manifest.scope
  }, analyzed.map(({ entry, frames }) => ({ entry, frames })), options);
  return {
    ...report,
    rasterSources: analyzed.map((fixture) => ({
      id: fixture.entry.id,
      path: fixture.entry.source.path,
      sha256: fixture.sourceSha256,
      origin: fixture.entry.source.origin,
      license: fixture.entry.source.license,
      analyzedFrames: fixture.frames.length
    }))
  };
}
