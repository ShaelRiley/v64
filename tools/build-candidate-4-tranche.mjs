#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRasterCorpusManifest } from "../prototype/js/raster-corpus.mjs";

export const CANDIDATE_4_ASSET_ID = "V64-P256-HYPERREAL-CANDIDATE-4";
const BASELINE_ASSET_ID = "V64-P256-CANDIDATE-1";
const CANDIDATE_3_ASSET_ID = "V64-P256-HYPERREAL-CANDIDATE-3";

export function buildCandidate4Tranche(input) {
  const source = validateRasterCorpusManifest(input);
  if (source.id !== "V64-HUMAN-RASTER-TRANCHE-2") {
    throw new Error(`Candidate-4 tranche requires V64-HUMAN-RASTER-TRANCHE-2; received ${source.id}`);
  }

  let replaced = 0;
  const entries = source.entries.map((entry) => {
    if (entry.paletteAsset === BASELINE_ASSET_ID) return structuredClone(entry);
    if (entry.paletteAsset !== CANDIDATE_3_ASSET_ID) {
      throw new Error(`Unexpected palette ${entry.paletteAsset} in ${entry.id}`);
    }
    if (!entry.id.endsWith("-hyperreal-3")) {
      throw new Error(`Candidate-3 lane lacks the expected id suffix: ${entry.id}`);
    }
    replaced += 1;
    return {
      ...structuredClone(entry),
      id: entry.id.replace(/-hyperreal-3$/, "-hyperreal-4"),
      paletteAsset: CANDIDATE_4_ASSET_ID
    };
  });

  if (replaced !== source.entries.length / 2) {
    throw new Error(`Expected a matched half-corpus replacement; replaced ${replaced}`);
  }

  return validateRasterCorpusManifest({
    ...source,
    id: "V64-HUMAN-RASTER-TRANCHE-3",
    title: "V64 Candidate-1 and Hyper Real Candidate-4 matched visual tranche",
    scope: "The fourteen tranche-2 lanes are held source-, grid-, cadence-, and stability-identical while Hyper Real Candidate 3 is replaced by Candidate 4. This isolates Candidate 4's restored light-neutral utility in matched depth, monochrome, screen-capture, and 60/80-column subtitle comparisons.",
    entries
  });
}

export function writeCandidate4Tranche(sourcePath, outputPath) {
  const source = JSON.parse(readFileSync(resolve(sourcePath), "utf8"));
  const manifest = buildCandidate4Tranche(source);
  const destination = resolve(outputPath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    format: "V64-CANDIDATE-4-TRANCHE-BUILD-1",
    sourceManifest: source.id,
    outputManifest: manifest.id,
    outputPath: destination,
    entries: manifest.entries.length,
    candidate4Entries: manifest.entries.filter((entry) =>
      entry.paletteAsset === CANDIDATE_4_ASSET_ID).length
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !outputPath) {
    throw new Error("Usage: build-candidate-4-tranche SOURCE_MANIFEST.json OUTPUT_MANIFEST.json");
  }
  console.log(JSON.stringify(writeCandidate4Tranche(sourcePath, outputPath), null, 2));
}
