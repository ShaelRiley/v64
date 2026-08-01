#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync
} from "node:fs";
import { basename, resolve } from "node:path";
import { validateRasterCorpusManifest } from "../prototype/js/raster-corpus.mjs";

const [manifestArgument, previewArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument || !previewArgument || !outputArgument) {
  throw new Error("Usage: build-blind-review MANIFEST.json PREVIEW_DIRECTORY OUTPUT_DIRECTORY");
}

const manifestPath = resolve(manifestArgument);
const previewDirectory = resolve(previewArgument);
const outputDirectory = resolve(outputArgument);
const imageDirectory = resolve(outputDirectory, "images");
const manifest = validateRasterCorpusManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
const previewFiles = readdirSync(previewDirectory);
mkdirSync(imageDirectory, { recursive: true });

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
  const matches = previewFiles.filter((file) =>
    file.startsWith(`${entry.id}-frame`) && file.endsWith(".png"));
  if (matches.length !== 1) {
    throw new Error(`Expected one preview for ${entry.id}; found ${matches.length}`);
  }
  const code = blindCode(entry.id);
  const source = resolve(previewDirectory, matches[0]);
  const destination = resolve(imageDirectory, `${code}.png`);
  copyFileSync(source, destination);
  return {
    code,
    group: entry.review.group,
    structuralClass: entry.structuralClass,
    columns: entry.grid.columns,
    rows: entry.grid.rows,
    questions: entry.review.questions,
    recognizabilityTargets: entry.recognizabilityTargets || [],
    entryId: entry.id,
    paletteAsset: entry.paletteAsset,
    sourcePath: entry.source.path || `generated:${entry.source.generatorId}`,
    sourcePreview: basename(matches[0]),
    blindImage: `images/${code}.png`
  };
});

const publicRows = rows.map(({ entryId, paletteAsset, sourcePath, sourcePreview, ...row }) => row);
const worksheetHeader = [
  "group", "code", "structural_class", "grid", "questions", "targets",
  "recognizability_1_to_5", "color_or_grayscale_1_to_5",
  "temporal_stability_1_to_5", "subtitle_transcription", "notes"
];
const worksheetLines = [worksheetHeader.join(",")];
for (const row of publicRows) {
  worksheetLines.push([
    row.group,
    row.code,
    row.structuralClass,
    `${row.columns}x${row.rows}`,
    row.questions.join(" | "),
    row.recognizabilityTargets.join(" | "),
    "", "", "", "", ""
  ].map(csv).join(","));
}

const groups = [...new Set(publicRows.map((row) => row.group))].sort();
const markdown = [
  "# V64 blinded recognizability worksheet",
  "",
  `Manifest: \`${manifest.id}\``,
  "",
  "Review every image at 100% scale before consulting the private key. Within each",
  "group, score recognizability, color or grayscale separation, and temporal",
  "stability from 1 (failed) to 5 (excellent). For subtitle groups, transcribe the",
  "caption exactly as perceived; leave it blank when unreadable.",
  "",
  "Do not infer palette identity from file order. The public worksheet contains only",
  "stable blind codes. `key.json` must remain hidden until scoring is complete.",
  "",
  "## Review groups",
  "",
  ...groups.map((group) => `- \`${group}\``),
  ""
].join("\n");

writeFileSync(resolve(outputDirectory, "worksheet.csv"), `${worksheetLines.join("\n")}\n`);
writeFileSync(resolve(outputDirectory, "worksheet.md"), markdown);
writeFileSync(resolve(outputDirectory, "public-manifest.json"), `${JSON.stringify({
  format: "V64-BLIND-REVIEW-PUBLIC-1",
  sourceManifest: manifest.id,
  rows: publicRows
}, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "key.json"), `${JSON.stringify({
  format: "V64-BLIND-REVIEW-KEY-1",
  warning: "Keep hidden until scoring is complete.",
  sourceManifest: manifest.id,
  rows: rows.map(({ code, group, entryId, paletteAsset, sourcePath, sourcePreview }) => ({
    code, group, entryId, paletteAsset, sourcePath, sourcePreview
  }))
}, null, 2)}\n`);

console.log(JSON.stringify({
  format: "V64-BLIND-REVIEW-BUILD-1",
  sourceManifest: manifest.id,
  outputDirectory,
  images: rows.length,
  groups: groups.length
}, null, 2));
