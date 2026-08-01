#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import { validateRasterCorpusManifest } from "../prototype/js/raster-corpus.mjs";

const [manifestArgument, motionArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument || !motionArgument || !outputArgument) {
  throw new Error(
    "Usage: build-blind-motion-review MANIFEST.json MOTION_DIRECTORY OUTPUT_DIRECTORY"
  );
}

const manifestPath = resolve(manifestArgument);
const motionDirectory = resolve(motionArgument);
const outputDirectory = resolve(outputArgument);
const blindDirectory = resolve(outputDirectory, "motion");
const manifest = validateRasterCorpusManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
mkdirSync(blindDirectory, { recursive: true });

function blindCode(entryId) {
  return createHash("sha256")
    .update(`${manifest.id}\0${entryId}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rows = manifest.entries.map((entry) => {
  if (!entry.review) throw new Error(`Entry ${entry.id} lacks blind-review metadata`);
  const source = resolve(motionDirectory, `${entry.id}.mp4`);
  const bytes = readFileSync(source);
  if (!bytes.length) throw new Error(`Empty motion preview for ${entry.id}`);
  const code = blindCode(entry.id);
  const destination = resolve(blindDirectory, `${code}.mp4`);
  copyFileSync(source, destination);
  return {
    code,
    group: entry.review.group,
    structuralClass: entry.structuralClass,
    columns: entry.grid.columns,
    rows: entry.grid.rows,
    questions: entry.review.questions,
    recognizabilityTargets: entry.recognizabilityTargets || [],
    motion: `motion/${code}.mp4`,
    bytes: statSync(destination).size,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
});

const worksheetHeader = [
  "group", "code", "structural_class", "grid", "questions", "targets",
  "temporal_stability_1_to_5", "motion_recognizability_1_to_5", "notes"
];
const worksheetLines = [worksheetHeader.join(",")];
for (const row of rows) {
  worksheetLines.push([
    row.group,
    row.code,
    row.structuralClass,
    `${row.columns}x${row.rows}`,
    row.questions.join(" | "),
    row.recognizabilityTargets.join(" | "),
    "", "", ""
  ].map(csv).join(","));
}

const markdown = [
  "# V64 anonymous motion-review worksheet",
  "",
  `Manifest: \`${manifest.id}\``,
  "",
  "Open each code-named MP4 at 100% scale. Score temporal stability from 1",
  "(severe chatter, tearing, or unstable identity) to 5 (stable and coherent).",
  "Score motion recognizability separately. Do not open the existing private",
  "`key.json` until every still and motion score is complete.",
  "",
  "The motion code is identical to the corresponding still-image code, permitting",
  "paired review without disclosing palette or source identity.",
  ""
].join("\n");

writeFileSync(
  resolve(outputDirectory, "temporal-worksheet.csv"),
  `${worksheetLines.join("\n")}\n`
);
writeFileSync(resolve(outputDirectory, "motion-review.md"), markdown);
writeFileSync(resolve(outputDirectory, "motion-public-manifest.json"), `${JSON.stringify({
  format: "V64-BLIND-MOTION-PUBLIC-1",
  sourceManifest: manifest.id,
  rows
}, null, 2)}\n`);

console.log(JSON.stringify({
  format: "V64-BLIND-MOTION-BUILD-1",
  sourceManifest: manifest.id,
  outputDirectory,
  clips: rows.length,
  groups: new Set(rows.map((row) => row.group)).size
}, null, 2));
