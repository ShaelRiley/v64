#!/usr/bin/env node
import process from "node:process";

import {
  createDropJob,
  createDropQueue,
  enqueueDropInputs,
  suggestDropOutputPath
} from "./model.mjs";
import {
  createDropPreview,
  estimateDropOutputSize
} from "./preview.mjs";
import {
  analyzeDropJob,
  runDropJob
} from "./runner.mjs";

function parseArguments(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Option --${key} requires a value`);
    options[key] = next;
    index += 1;
  }
  return { positional, options };
}

function usage() {
  return `Video64 Drop application core

Usage:
  video64-drop plan INPUT... [--output-directory DIR] [encoder options]
  video64-drop inspect INPUT [--fps 24] [--columns 80] [--palette 32]
                              [--glyphs 32|64] [--profile balanced]
  video64-drop estimate INPUT [same options]
                              [--sample-seconds 2] [--sample-count 3]
  video64-drop preview INPUT OUTPUT_DIRECTORY [same options]
                              [--sample-seconds 2] [--sample-count 3]
  video64-drop encode INPUT [OUTPUT.v64] [same options]

The estimate command performs short proof encodes at deterministic points across
the source. Its result is advisory and never replaces exact post-encode
verification. Preview writes source, decoded-V64, and side-by-side PPM images
plus a JSON manifest. Progress events from encode are written as newline-delimited
JSON to standard error. The completed job document is written to standard output.`;
}

function settingsFromOptions(options) {
  return {
    fps: options.fps,
    columns: options.columns,
    palette: options.palette,
    glyphs: options.glyphs,
    profile: options.profile
  };
}

function sampleOptionsFromOptions(options) {
  const result = {};
  if (options["sample-seconds"] !== undefined) {
    result.sampleSeconds = Number(options["sample-seconds"]);
  }
  if (options["sample-count"] !== undefined) {
    result.sampleCount = Number(options["sample-count"]);
  }
  return result;
}

function eventSummary(job) {
  const stage = Object.values(job.stages).find((entry) => entry.state === "running") ?? null;
  return {
    format: "VIDEO64-DROP-EVENT-1",
    jobId: job.id,
    status: job.status,
    stage: stage?.id ?? null,
    detail: stage?.detail ?? null
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    console.log(usage());
    return;
  }
  const { positional, options } = parseArguments(rest);
  if (command === "plan") {
    if (positional.length === 0) throw new Error("plan requires at least one input file");
    const queue = enqueueDropInputs(
      createDropQueue({ settings: settingsFromOptions(options) }),
      positional,
      { outputDirectory: options["output-directory"] ?? null }
    );
    console.log(JSON.stringify(queue, null, 2));
    return;
  }
  if (command === "inspect") {
    if (positional.length !== 1) throw new Error("inspect requires one input file");
    const job = createDropJob({
      id: "drop-0001",
      inputPath: positional[0],
      settings: settingsFromOptions(options)
    });
    console.log(JSON.stringify(analyzeDropJob(job), null, 2));
    return;
  }
  if (command === "estimate") {
    if (positional.length !== 1) throw new Error("estimate requires one input file");
    const result = estimateDropOutputSize(
      positional[0],
      settingsFromOptions(options),
      sampleOptionsFromOptions(options)
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "preview") {
    if (positional.length !== 2) {
      throw new Error("preview requires INPUT and OUTPUT_DIRECTORY");
    }
    const result = createDropPreview(
      positional[0],
      positional[1],
      settingsFromOptions(options),
      sampleOptionsFromOptions(options)
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "encode") {
    if (positional.length < 1 || positional.length > 2) {
      throw new Error("encode requires INPUT and an optional OUTPUT.v64");
    }
    const outputPath = positional[1] ?? suggestDropOutputPath(positional[0]);
    const job = createDropJob({
      id: "drop-0001",
      inputPath: positional[0],
      outputPath,
      settings: settingsFromOptions(options)
    });
    const result = await runDropJob(job, {
      onUpdate(snapshot) {
        process.stderr.write(`${JSON.stringify(eventSummary(snapshot))}\n`);
      }
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "completed") process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown command "${command}"\n\n${usage()}`);
}

main().catch((error) => {
  console.error(`video64-drop: ${error.message}`);
  process.exitCode = 1;
});
