import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HYPERREAL_ANCHORS,
  hyperRealGrade,
  paletteBytes,
  paletteHash
} from "./hyperreal-palette-generator.mjs";

export const HYPERREAL_CANDIDATE_5A_UTILITY = Object.freeze([
  [0, 92, 96],
  [32, 32, 32],
  [224, 224, 224],
  [112, 112, 112]
]);

export const HYPERREAL_CANDIDATE_5B_UTILITY = Object.freeze([
  [16, 32, 72],
  [32, 32, 32],
  [224, 224, 224],
  [112, 112, 112]
]);

export const HYPERREAL_CANDIDATE_5A_PREFIX = Object.freeze([
  ...HYPERREAL_ANCHORS,
  ...HYPERREAL_CANDIDATE_5A_UTILITY
]);

export const HYPERREAL_CANDIDATE_5B_PREFIX = Object.freeze([
  ...HYPERREAL_ANCHORS,
  ...HYPERREAL_CANDIDATE_5B_UTILITY
]);

function srgbToLinear(value) {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgbToOklab([r8, g8, b8]) {
  const r = srgbToLinear(r8);
  const g = srgbToLinear(g8);
  const b = srgbToLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

function distanceSquared(a, b) {
  const lightness = (a[0] - b[0]) * 1.1;
  const greenRed = a[1] - b[1];
  const blueYellow = a[2] - b[2];
  return lightness * lightness + greenRed * greenRed + blueYellow * blueYellow;
}

function unique(colors) {
  const seen = new Set();
  return colors.filter((color) => {
    const key = color.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generatePalette(prefix) {
  const selected = unique(prefix.map((color) => [...color]));
  const selectedKeys = new Set(selected.map((color) => color.join(",")));
  const candidates = unique(Array.from({ length: 16 ** 3 }, (_, index) => {
    const r = Math.floor(index / 256) * 17;
    const g = Math.floor(index / 16) % 16 * 17;
    const b = index % 16 * 17;
    return hyperRealGrade([r, g, b]);
  })).map((rgb) => ({
    rgb,
    lab: rgbToOklab(rgb),
    minimumDistance: Number.POSITIVE_INFINITY
  }));

  for (const color of selected) {
    const lab = rgbToOklab(color);
    for (const candidate of candidates) {
      candidate.minimumDistance = Math.min(
        candidate.minimumDistance,
        distanceSquared(candidate.lab, lab)
      );
    }
  }

  while (selected.length < 256) {
    let best = null;
    for (const candidate of candidates) {
      if (selectedKeys.has(candidate.rgb.join(","))) continue;
      if (!best ||
          candidate.minimumDistance > best.minimumDistance + 1e-15 ||
          (Math.abs(candidate.minimumDistance - best.minimumDistance) <= 1e-15 &&
            candidate.rgb.join(",") < best.rgb.join(","))) {
        best = candidate;
      }
    }
    if (!best) throw new Error("Hyper Real Candidate-5 lattice exhausted");
    selected.push([...best.rgb]);
    selectedKeys.add(best.rgb.join(","));
    for (const candidate of candidates) {
      candidate.minimumDistance = Math.min(
        candidate.minimumDistance,
        distanceSquared(candidate.lab, best.lab)
      );
    }
  }
  return selected;
}

export function generateHyperRealCandidate5APalette() {
  return generatePalette(HYPERREAL_CANDIDATE_5A_PREFIX);
}

export function generateHyperRealCandidate5BPalette() {
  return generatePalette(HYPERREAL_CANDIDATE_5B_PREFIX);
}

function prefixHash(prefix) {
  return createHash("sha256").update(Buffer.from(prefix.flat())).digest("hex");
}

function metadata(id, prefix, colors, rationale) {
  return {
    id,
    status: "experimental-ablation",
    source: {
      repository: "ShaelRiley/ansi-tube",
      file: "core.js",
      blobSha: "29fd2065612454a66a92e431213731c41d5dc28c",
      palette: "hyperreal",
      anchorsSha256: createHash("sha256")
        .update(Buffer.from(HYPERREAL_ANCHORS.flat()))
        .digest("hex"),
      saturationGrade: 1.60,
      contrastGrade: 1.12
    },
    prefix: { sha256: prefixHash(prefix), rationale },
    generation: "controlled Candidate-5 prefix followed by ordered OKLab farthest-point sampling over the Hyper Real-graded 16^3 sRGB lattice",
    sha256: paletteHash(colors),
    generatedColors: true
  };
}

export function candidate5Assets() {
  const candidate5a = generateHyperRealCandidate5APalette();
  const candidate5b = generateHyperRealCandidate5BPalette();
  return [
    {
      stem: "v64-p256-hyperreal-candidate-5a",
      metadata: metadata(
        "V64-P256-HYPERREAL-CANDIDATE-5A",
        HYPERREAL_CANDIDATE_5A_PREFIX,
        candidate5a,
        "Exact twelve Hyper Real anchors plus dark teal, dark neutral, light neutral, and neutral midtone; dark navy is omitted."
      ),
      colors: candidate5a
    },
    {
      stem: "v64-p256-hyperreal-candidate-5b",
      metadata: metadata(
        "V64-P256-HYPERREAL-CANDIDATE-5B",
        HYPERREAL_CANDIDATE_5B_PREFIX,
        candidate5b,
        "Exact twelve Hyper Real anchors plus dark navy, dark neutral, light neutral, and neutral midtone; dark teal is omitted."
      ),
      colors: candidate5b
    }
  ];
}

export function writeCandidate5Assets(outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const assets = candidate5Assets();
  for (const asset of assets) {
    writeFileSync(
      resolve(outputDirectory, `${asset.stem}.json`),
      `${JSON.stringify(asset.metadata, null, 2)}\n`
    );
    writeFileSync(resolve(outputDirectory, `${asset.stem}.rgb`), paletteBytes(asset.colors));
  }
  return {
    format: "V64-HYPERREAL-CANDIDATE-5-BUILD-1",
    candidates: assets.map((asset) => ({
      id: asset.metadata.id,
      prefixSha256: asset.metadata.prefix.sha256,
      sha256: asset.metadata.sha256,
      bytes: paletteBytes(asset.colors).length
    }))
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] || new URL("../assets/palettes", import.meta.url).pathname);
  console.log(JSON.stringify(writeCandidate5Assets(output), null, 2));
}
