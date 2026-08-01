#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRasterCorpusManifest } from "../prototype/js/raster-corpus.mjs";

const GROUPS = ["depth-40", "monochrome-40", "screen-40"];
const CONTROL_IDS = [
  "V64-P256-CANDIDATE-1",
  "V64-P256-HYPERREAL-CANDIDATE-5A",
  "V64-P256-HYPERREAL-CANDIDATE-5B"
];
const FINALISTS = [
  ["-hyperreal-6a", "V64-P256-HYPERREAL-CANDIDATE-6A"],
  ["-hyperreal-6b", "V64-P256-HYPERREAL-CANDIDATE-6B"],
  ["-hyperreal-6c", "V64-P256-HYPERREAL-CANDIDATE-6C"]
];

function variant(entry, suffix, paletteAsset) {
  const result = structuredClone(entry);
  result.id = result.id.replace(/-hyperreal-5b$/, suffix);
  result.paletteAsset = paletteAsset;
  return result;
}

export function buildCandidate6Finalists(input) {
  const source = validateRasterCorpusManifest(input);
  if (source.id !== "V64-HUMAN-RASTER-TRANCHE-4") {
    throw new Error(`Candidate-6 finalists require tranche 4; received ${source.id}`);
  }
  const entries = [];
  for (const group of GROUPS) {
    const lanes = source.entries.filter((entry) => entry.review?.group === group);
    const controls = CONTROL_IDS.map((id) => lanes.find((entry) => entry.paletteAsset === id));
    if (controls.some((entry) => !entry) || lanes.length !== 4) {
      throw new Error(`Incomplete Candidate-6 source group ${group}`);
    }
    const candidate5b = controls[2];
    if (!candidate5b.id.endsWith("-hyperreal-5b")) {
      throw new Error(`Candidate-5B source lacks expected suffix for ${group}`);
    }
    entries.push(
      ...controls.map((entry) => structuredClone(entry)),
      ...FINALISTS.map(([suffix, paletteAsset]) => variant(candidate5b, suffix, paletteAsset))
    );
  }
  return validateRasterCorpusManifest({
    ...source,
    id: "V64-HUMAN-RASTER-TRANCHE-5",
    title: "V64 constrained dark-chroma finalist tranche",
    scope: "A source-, grid-, cadence-, and matcher-matched comparison of Candidate 1, the Candidate-5 endpoints, and three reproducible teal-to-navy interpolation finalists across depth, monochrome, and screen-capture scenes.",
    entries
  });
}

export function writeCandidate6Finalists(sourcePath, outputPath) {
  const source = JSON.parse(readFileSync(resolve(sourcePath), "utf8"));
  const manifest = buildCandidate6Finalists(source);
  const destination = resolve(outputPath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    format: "V64-CANDIDATE-6-FINALIST-BUILD-1",
    sourceManifest: source.id,
    outputManifest: manifest.id,
    entries: manifest.entries.length,
    groups: GROUPS,
    outputPath: destination
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !outputPath) {
    throw new Error("Usage: build-candidate-6-finalists SOURCE_MANIFEST OUTPUT_MANIFEST");
  }
  console.log(JSON.stringify(writeCandidate6Finalists(sourcePath, outputPath), null, 2));
}
