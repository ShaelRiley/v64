#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyV1File } from "./v1-registry.mjs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error("usage: node prototype/js/verify-v1.mjs INPUT.v64");
  process.exitCode = 2;
} else {
  try {
    const result = verifyV1File(readFileSync(inputPath));
    console.log(JSON.stringify({ path: resolve(inputPath), ...result }, null, 2));
  } catch (error) {
    console.error(`v64-v1-verify: ${error.message}`);
    process.exitCode = 1;
  }
}
