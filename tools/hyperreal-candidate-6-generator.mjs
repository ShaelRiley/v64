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

export const CANDIDATE_6_DARK_CHROMA = Object.freeze({
  A: Object.freeze([4, 77, 90]),
  B: Object.freeze([8, 62, 84]),
  C: Object.freeze([12, 47, 78])
});

const NEUTRALS = Object.freeze([
  Object.freeze([32, 32, 32]),
  Object.freeze([224, 224, 224]),
  Object.freeze([112, 112, 112])
]);

function prefix(darkChroma) {
  return Object.freeze([
    ...HYPERREAL_ANCHORS,
    darkChroma,
    ...NEUTRALS
  ]);
}

export const HYPERREAL_CANDIDATE_6A_PREFIX = prefix(CANDIDATE_6_DARK_CHROMA.A);
export const HYPERREAL_CANDIDATE_6B_PREFIX = prefix(CANDIDATE_6_DARK_CHROMA.B);
export const HYPERREAL_CANDIDATE_6C_PREFIX = prefix(CANDIDATE_6_DARK_CHROMA.C);

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
  return lightness * lightness + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
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

function generatePalette(candidatePrefix) {
  const selected = unique(candidatePrefix.map((color) => [...color]));
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
    if (!best) throw new Error("Hyper Real Candidate-6 lattice exhausted");
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

export function generateHyperRealCandidate6APalette() {
  return generatePalette(HYPERREAL_CANDIDATE_6A_PREFIX);
}

export function generateHyperRealCandidate6BPalette() {
  return generatePalette(HYPERREAL_CANDIDATE_6B_PREFIX);
}

export function generateHyperRealCandidate6CPalette() {
  return generatePalette(HYPERREAL_CANDIDATE_6C_PREFIX);
}

function prefixHash(candidatePrefix) {
  return createHash("sha256").update(Buffer.from(candidatePrefix.flat())).digest("hex");
}

function metadata(id, candidatePrefix, colors, fraction, darkChroma) {
  return {
    id,
    status: "experimental-finalist-interpolation",
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
    interpolation: {
      fractionFromTealToNavy: fraction,
      tealEndpoint: [0, 92, 96],
      navyEndpoint: [16, 32, 72],
      darkChroma
    },
    prefix: {
      sha256: prefixHash(candidatePrefix),
      rationale: "Exact twelve Hyper Real anchors plus one constrained teal-to-navy dark-chroma interpolation and fixed dark, light, and middle neutral rungs."
    },
    generation: "Candidate-6 constrained prefix followed by ordered OKLab farthest-point sampling over the Hyper Real-graded 16^3 sRGB lattice",
    sha256: paletteHash(colors),
    generatedColors: true
  };
}

export function candidate6Assets() {
  const definitions = [
    ["A", HYPERREAL_CANDIDATE_6A_PREFIX, generateHyperRealCandidate6APalette(), 0.25],
    ["B", HYPERREAL_CANDIDATE_6B_PREFIX, generateHyperRealCandidate6BPalette(), 0.50],
    ["C", HYPERREAL_CANDIDATE_6C_PREFIX, generateHyperRealCandidate6CPalette(), 0.75]
  ];
  return definitions.map(([suffix, candidatePrefix, colors, fraction]) => ({
    stem: `v64-p256-hyperreal-candidate-6${suffix.toLowerCase()}`,
    metadata: metadata(
      `V64-P256-HYPERREAL-CANDIDATE-6${suffix}`,
      candidatePrefix,
      colors,
      fraction,
      CANDIDATE_6_DARK_CHROMA[suffix]
    ),
    colors
  }));
}

export function writeCandidate6Assets(outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const assets = candidate6Assets();
  for (const asset of assets) {
    writeFileSync(resolve(outputDirectory, `${asset.stem}.json`), `${JSON.stringify(asset.metadata, null, 2)}\n`);
    writeFileSync(resolve(outputDirectory, `${asset.stem}.rgb`), paletteBytes(asset.colors));
  }
  return {
    format: "V64-HYPERREAL-CANDIDATE-6-BUILD-1",
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
  console.log(JSON.stringify(writeCandidate6Assets(output), null, 2));
}
