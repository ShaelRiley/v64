#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERATED_RASTER_SOURCE_IDS,
  generatedRasterSourceFromId
} from "../prototype/js/generated-raster-sources.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(process.argv[2] || resolve(ROOT, "bench/corpus/generated/stills"));
mkdirSync(OUTPUT, { recursive: true });

const fixtures = GENERATED_RASTER_SOURCE_IDS.map((id) => {
  const source = generatedRasterSourceFromId(id);
  const path = resolve(OUTPUT, `${id}.ppm`);
  writeFileSync(path, source.bytes);
  return {
    id,
    file: path,
    sha256: source.sha256,
    bytes: source.bytes.length,
    width: source.width,
    height: source.height
  };
});

console.log(JSON.stringify({
  format: "V64-MISSING-CLASS-PLATES-1",
  license: "CC0-1.0",
  fixtures
}, null, 2));
