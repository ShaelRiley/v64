import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEEDS = [
  [0, 0, 0], [255, 255, 255], [128, 128, 128], [220, 40, 48],
  [36, 176, 82], [48, 92, 220], [246, 214, 52], [48, 202, 212],
  [210, 56, 190], [48, 48, 52], [208, 208, 212], [238, 174, 132],
  [240, 118, 36], [116, 70, 44], [116, 70, 190], [28, 132, 126]
];

function srgbToLinear(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
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
  const dl = (a[0] - b[0]) * 1.25;
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

export function generateMasterPalette() {
  const candidates = [];
  for (let r = 0; r <= 255; r += 17) {
    for (let g = 0; g <= 255; g += 17) {
      for (let b = 0; b <= 255; b += 17) candidates.push({ rgb: [r, g, b], lab: rgbToOklab([r, g, b]), min: Infinity });
    }
  }
  const selected = SEEDS.map((rgb) => [...rgb]);
  const selectedKeys = new Set(selected.map((rgb) => rgb.join(",")));
  for (const rgb of selected) {
    const lab = rgbToOklab(rgb);
    for (const candidate of candidates) candidate.min = Math.min(candidate.min, distanceSquared(candidate.lab, lab));
  }
  while (selected.length < 256) {
    let best = null;
    for (const candidate of candidates) {
      if (selectedKeys.has(candidate.rgb.join(","))) continue;
      if (!best || candidate.min > best.min + 1e-15 ||
          (Math.abs(candidate.min - best.min) <= 1e-15 && candidate.rgb.join(",") < best.rgb.join(","))) best = candidate;
    }
    selected.push([...best.rgb]);
    selectedKeys.add(best.rgb.join(","));
    for (const candidate of candidates) candidate.min = Math.min(candidate.min, distanceSquared(candidate.lab, best.lab));
  }
  return selected;
}

export function paletteBytes(palette) {
  return Buffer.from(palette.flat());
}

export function paletteHash(palette) {
  return createHash("sha256").update(paletteBytes(palette)).digest("hex");
}

export function writePaletteAssets(outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const palette = generateMasterPalette();
  const bytes = paletteBytes(palette);
  const hash = paletteHash(palette);
  writeFileSync(resolve(outputDirectory, "v64-p256-candidate-1.rgb"), bytes);
  writeFileSync(resolve(outputDirectory, "v64-p256-candidate-1.json"), `${JSON.stringify({
    id: "V64-P256-CANDIDATE-1",
    status: "immutable-candidate",
    generation: "seeded ordered OKLab farthest-point sampling over the 16^3 sRGB lattice",
    sha256: hash,
    colors: palette
  }, null, 2)}\n`);
  return { palette, hash, bytes: bytes.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] || new URL("../assets/palettes", import.meta.url).pathname);
  console.log(JSON.stringify(writePaletteAssets(output), null, 2));
}
