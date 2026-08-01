#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRasterCorpusManifest } from "../prototype/js/raster-corpus.mjs";

export const CANDIDATE_5A_ASSET_ID = "V64-P256-HYPERREAL-CANDIDATE-5A";
export const CANDIDATE_5B_ASSET_ID = "V64-P256-HYPERREAL-CANDIDATE-5B";
const BASELINE = "V64-P256-CANDIDATE-1";
const CANDIDATE_4 = "V64-P256-HYPERREAL-CANDIDATE-4";
const GROUPS = ["depth-40", "monochrome-40", "screen-40"];

function variant(entry, suffix, paletteAsset) {
  const result = structuredClone(entry);
  result.id = result.id.replace(/-hyperreal-4$/, suffix);
  result.paletteAsset = paletteAsset;
  return result;
}

export function buildCandidate5Ablation(input) {
  const source = validateRasterCorpusManifest(input);
  if (source.id !== "V64-HUMAN-RASTER-TRANCHE-3") {
    throw new Error(`Candidate-5 ablation requires tranche 3; received ${source.id}`);
  }
  const entries = [];
  for (const group of GROUPS) {
    const lanes = source.entries.filter((entry) => entry.review?.group === group);
    const baseline = lanes.find((entry) => entry.paletteAsset === BASELINE);
    const candidate4 = lanes.find((entry) => entry.paletteAsset === CANDIDATE_4);
    if (!baseline || !candidate4 || lanes.length !== 2 ||
        !candidate4.id.endsWith("-hyperreal-4")) {
      throw new Error(`Incomplete Candidate-5 ablation group ${group}`);
    }
    entries.push(
      structuredClone(baseline),
      structuredClone(candidate4),
      variant(candidate4, "-hyperreal-5a", CANDIDATE_5A_ASSET_ID),
      variant(candidate4, "-hyperreal-5b", CANDIDATE_5B_ASSET_ID)
    );
  }
  return validateRasterCorpusManifest({
    ...source,
    id: "V64-HUMAN-RASTER-TRANCHE-4",
    title: "V64 Candidate-5 dark-neutral ablation",
    scope: "A compact matched comparison across depth, monochrome, and screen-capture scenes. Candidate 5A retains dark teal; Candidate 5B retains dark navy. Both add a dark neutral and retain the light and middle neutral rungs.",
    entries
  });
}

export function writeCandidate5Ablation(sourcePath, outputPath) {
  const source = JSON.parse(readFileSync(resolve(sourcePath), "utf8"));
  const manifest = buildCandidate5Ablation(source);
  const destination = resolve(outputPath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    format: "V64-CANDIDATE-5-ABLATION-BUILD-1",
    sourceManifest: source.id,
    outputManifest: manifest.id,
    outputPath: destination,
    entries: manifest.entries.length,
    groups: GROUPS
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !outputPath) {
    throw new Error("Usage: build-candidate-5-ablation SOURCE_MANIFEST OUTPUT_MANIFEST");
  }
  console.log(JSON.stringify(writeCandidate5Ablation(sourcePath, outputPath), null, 2));
}
