import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { deriveRows } from "../../prototype/js/constants.mjs";
import {
  demuxV64,
  makeChunk,
  muxV64,
  verifyV64
} from "../../prototype/js/container.mjs";
import { displayGeometryFromProbe } from "../../prototype/js/source-geometry.mjs";
import { encodeDropSourceAudio } from "./audio.mjs";
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
      "Source audio will be encoded as provisional AM1 mono 48 kHz constrained-VBR Opus. The 8 kbps speech setting remains subject to genuine blinded listening before it can freeze."
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

export function readDropVideoDuration(inputPath) {
  return demuxV64(readFileSync(inputPath)).header.duration;
}

function remuxableChunk(chunk) {
  return makeChunk(
    chunk.type,
    chunk.timestamp,
    chunk.duration,
    chunk.payload,
    {
      compress: Boolean(chunk.flags & 2),
      keyframe: chunk.type === "VFRM" && chunk.payload[0] === 0
    }
  );
}

export function muxDropOutput(videoOnlyPath, outputPath, audioChunks = []) {
  const demuxed = demuxV64(readFileSync(videoOnlyPath));
  const videoAndMetadata = demuxed.chunks
    .filter((chunk) => chunk.type !== "INDX")
    .map(remuxableChunk);
  const file = muxV64({
    columns: demuxed.header.columns,
    rows: demuxed.header.rows,
    cadenceId: demuxed.header.cadence.id,
    paletteDepthId: demuxed.header.paletteDepthId
  }, [...videoAndMetadata, ...audioChunks]);
  writeFileSync(outputPath, file);
  return {
    bytes: file.length,
    videoAndMetadataChunks: videoAndMetadata.length,
    audioChunks: audioChunks.length,
    audioRuns: audioChunks.filter((chunk) => chunk.type === "AURN").length,
    audioSilenceSpans: audioChunks.filter((chunk) => chunk.type === "SILN").length
  };
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
  encodeAudio = encodeDropSourceAudio,
  readVideoDuration = readDropVideoDuration,
  mux = muxDropOutput,
  verify = verifyDropOutput,
  onUpdate = () => {}
} = {}) {
  let snapshot = beginDropJob(job);
  let activeStage = null;
  let temporaryDirectory = null;
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

    temporaryDirectory = mkdtempSync(join(tmpdir(), "video64-drop-"));
    const videoOnlyPath = join(temporaryDirectory, "video-only.v64");
    stage("video_encode", "running", { detail: "Encoding the verified V64 video timeline" });
    const videoEncoded = await Promise.resolve(encode(
      snapshot.inputPath,
      videoOnlyPath,
      encoderOptionsFromDropSettings(snapshot.settings)
    ));
    const durationTicks = Number(
      videoEncoded.durationTicks ?? readVideoDuration(videoOnlyPath)
    );
    if (!Number.isSafeInteger(durationTicks) || durationTicks <= 0) {
      throw new Error("Encoded video did not provide a valid V64 duration");
    }
    stage("video_encode", "completed", {
      detail: `${videoEncoded.frames ?? "unknown"} frames encoded`
    });

    let audio = {
      chunks: [],
      summary: {
        format: "VIDEO64-DROP-AM1-SOURCE-1",
        profile: null,
        normative: false,
        sourcePresent: false,
        durationTicks,
        timelineChunks: 0,
        audibleRuns: 0,
        opusPackets: 0,
        silenceSpans: 0
      }
    };
    if (analysis.source.audioPresent) {
      stage("audio_encode", "running", {
        detail: "Encoding provisional AM1 mono 48 kHz audio"
      });
      audio = await Promise.resolve(encodeAudio(snapshot.inputPath, durationTicks));
      const detail = audio.summary.audibleRuns
        ? `${audio.summary.audibleRuns} AM1 runs, ${audio.summary.opusPackets} Opus packets`
        : `${audio.summary.silenceSpans} explicit silence spans`;
      stage("audio_encode", "completed", { detail });
    } else {
      stage("audio_encode", "skipped", { detail: "No source audio stream" });
    }

    stage("mux", "running", { detail: "Muxing video, metadata, and AM1 audio" });
    const muxed = await Promise.resolve(mux(
      videoOnlyPath,
      snapshot.outputPath,
      audio.chunks
    ));
    stage("mux", "completed", { detail: `${muxed.bytes ?? "unknown"} bytes written` });

    stage("verify", "running", { detail: "Verifying the completed audiovisual V64 file" });
    const verification = await Promise.resolve(verify(snapshot.outputPath));
    stage("verify", "completed", { detail: "V64 verification passed" });

    snapshot = completeDropJob(snapshot, {
      analysis,
      encoded: {
        ...videoEncoded,
        durationTicks,
        videoOnlyBytes: videoEncoded.bytes ?? null,
        bytes: muxed.bytes ?? verification.outputBytes,
        audio: audio.summary,
        mux: muxed
      },
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
  } finally {
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
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
