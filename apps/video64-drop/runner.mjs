import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { deriveRows } from "../../prototype/js/constants.mjs";
import { verifyV64 } from "../../prototype/js/container.mjs";
import { displayGeometryFromProbe } from "../../prototype/js/source-geometry.mjs";
import {
  DROP_CAPABILITIES,
  DROP_QUEUE_FORMAT,
  addDropWarning,
  beginDropJob,
  completeDropJob,
  encoderOptionsFromDropSettings,
  failDropJob,
  updateDropStage
} from "./model.mjs";

const PROOF_CLI_PATH = fileURLToPath(
  new URL("../../prototype/js/cli.mjs", import.meta.url)
);

function runProgram(program, args, spawn = spawnSync) {
  const result = spawn(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw new Error(`${program} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${program} failed (${result.status}): ${String(result.stderr).trim()}`);
  }
  return result.stdout;
}

export function probeDropSource(inputPath, { spawnSyncImpl = spawnSync } = {}) {
  const output = runProgram("ffprobe", [
    "-v", "error",
    "-show_entries",
    "stream=index,codec_type,codec_name,width,height,duration,sample_aspect_ratio,display_aspect_ratio,channels,sample_rate:stream_side_data=rotation:format=duration",
    "-of", "json",
    inputPath
  ], spawnSyncImpl);
  const document = JSON.parse(output);
  const streams = Array.isArray(document.streams) ? document.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("Input has no decodable video stream");
  const geometry = displayGeometryFromProbe(video);
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  const durationSeconds = Number(video.duration || document.format?.duration || 0);
  return {
    ...geometry,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : null,
    videoCodec: video.codec_name || null,
    audioPresent: audioStreams.length > 0,
    audioStreams: audioStreams.map((stream) => ({
      index: Number(stream.index),
      codec: stream.codec_name || null,
      channels: Number(stream.channels) || null,
      sampleRate: Number(stream.sample_rate) || null
    }))
  };
}

export function analyzeDropJob(job, { probe = probeDropSource } = {}) {
  const source = probe(job.inputPath);
  const rows = deriveRows(job.settings.columns, source.displayAspectRatio);
  const warnings = [];
  if (source.audioPresent) {
    warnings.push(
      "Source audio was detected. This first Video64 Drop tranche still uses the silent proof encoder; audio is not written to the output file."
    );
  }
  return {
    capabilities: DROP_CAPABILITIES,
    source,
    grid: {
      columns: job.settings.columns,
      rows,
      rasterWidth: job.settings.columns * 8,
      rasterHeight: rows * 16
    },
    settings: job.settings,
    warnings
  };
}

export function encodeDropVideo(inputPath, outputPath, options, {
  spawnSyncImpl = spawnSync
} = {}) {
  const args = [PROOF_CLI_PATH, "encode", inputPath, outputPath];
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    args.push(`--${key}`, String(value));
  }
  return JSON.parse(runProgram(process.execPath, args, spawnSyncImpl));
}

export function verifyDropOutput(outputPath) {
  const bytes = readFileSync(outputPath);
  return {
    ...verifyV64(bytes),
    outputBytes: statSync(outputPath).size
  };
}

export async function runDropJob(job, {
  probe = probeDropSource,
  encode = encodeDropVideo,
  verify = verifyDropOutput,
  onUpdate = () => {}
} = {}) {
  let snapshot = beginDropJob(job);
  let activeStage = null;
  const emit = () => onUpdate(snapshot);
  const stage = (id, state, options) => {
    activeStage = state === "running" ? id : activeStage === id ? null : activeStage;
    snapshot = updateDropStage(snapshot, id, state, options);
    emit();
  };
  emit();
  try {
    stage("analysis", "running", { detail: "Reading source media metadata" });
    const analysis = await Promise.resolve(analyzeDropJob(snapshot, { probe }));
    snapshot = { ...snapshot, analysis };
    for (const warning of analysis.warnings) snapshot = addDropWarning(snapshot, warning);
    stage("analysis", "completed", { detail: `${analysis.grid.columns}×${analysis.grid.rows} cells` });

    stage("video_encode", "running", { detail: "Encoding with the verified V64 proof pipeline" });
    const encoded = await Promise.resolve(encode(
      snapshot.inputPath,
      snapshot.outputPath,
      encoderOptionsFromDropSettings(snapshot.settings)
    ));
    stage("video_encode", "completed", {
      detail: `${encoded.frames ?? "unknown"} frames encoded`
    });

    stage("audio_encode", "skipped", {
      detail: analysis.source.audioPresent
        ? "Source audio detected; AM1 encoding is not connected to Video64 Drop yet"
        : "No source audio stream"
    });

    stage("mux", "running", { detail: "Finalizing the V64 container" });
    stage("mux", "completed", { detail: `${encoded.bytes ?? "unknown"} bytes written` });

    stage("verify", "running", { detail: "Verifying the completed V64 file" });
    const verification = await Promise.resolve(verify(snapshot.outputPath));
    stage("verify", "completed", { detail: "V64 verification passed" });

    snapshot = completeDropJob(snapshot, {
      analysis,
      encoded,
      verification
    });
    emit();
    return snapshot;
  } catch (error) {
    if (activeStage) {
      snapshot = updateDropStage(snapshot, activeStage, "failed", {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
    snapshot = failDropJob(snapshot, error);
    emit();
    return snapshot;
  }
}

export async function runDropQueue(queue, options = {}) {
  if (queue?.format !== DROP_QUEUE_FORMAT) throw new TypeError("Invalid Video64 Drop queue");
  const jobs = [];
  for (const job of queue.jobs) {
    if (job.status !== "queued") {
      jobs.push(job);
      continue;
    }
    jobs.push(await runDropJob(job, options));
  }
  return { ...queue, jobs };
}
