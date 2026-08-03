import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import process from "node:process";

import {
  encodeDropAudioTimeline,
  extractDropAudioPcm
} from "../apps/video64-drop/audio.mjs";
import {
  DEFAULT_DROP_SETTINGS,
  createDropJob,
  createDropQueue,
  enqueueDropInputs,
  normalizeDropSettings,
  suggestDropOutputPath
} from "../apps/video64-drop/model.mjs";
import {
  analyzeDropJob,
  encodeDropVideo,
  runDropJob,
  runDropQueue
} from "../apps/video64-drop/runner.mjs";
import { synthesizeAm1Fixture } from "../prototype/js/audio-am1.mjs";

test("Video64 Drop keeps the normative encoder defaults", () => {
  assert.deepEqual(normalizeDropSettings(), DEFAULT_DROP_SETTINGS);
  assert.deepEqual(normalizeDropSettings({
    fps: 60,
    columns: "120",
    palette: "64",
    glyphs: "64",
    profile: "CLEAREST"
  }), {
    fps: "60",
    columns: 120,
    palette: 64,
    glyphs: 64,
    profile: "clearest"
  });
});

test("Video64 Drop rejects settings outside the frozen product vocabulary", () => {
  assert.throws(() => normalizeDropSettings({ fps: 25 }), /Illegal V64 cadence/);
  assert.throws(() => normalizeDropSettings({ palette: 10 }), /Illegal V64 palette/);
  assert.throws(() => normalizeDropSettings({ glyphs: 16 }), /32 or 64/);
  assert.throws(() => normalizeDropSettings({ profile: "maximum" }), /smallest, balanced, or clearest/);
});

test("output suggestions preserve the source directory and avoid v64 overwrite", () => {
  assert.equal(suggestDropOutputPath("/tmp/movie.mp4"), "/tmp/movie.v64");
  assert.equal(suggestDropOutputPath("/tmp/movie.v64"), "/tmp/movie.encoded.v64");
  assert.equal(suggestDropOutputPath("/tmp/movie.mp4", "/tmp/out"), "/tmp/out/movie.v64");
});

test("queue ingestion is stable, sequential, and deduplicated", () => {
  let queue = createDropQueue();
  queue = enqueueDropInputs(queue, ["a.mp4", "b.mkv", "a.mp4"]);
  assert.equal(queue.jobs.length, 2);
  assert.deepEqual(queue.jobs.map((job) => job.id), ["drop-0001", "drop-0002"]);
  assert.deepEqual(queue.jobs.map((job) => job.inputPath), [resolve("a.mp4"), resolve("b.mkv")]);
});

test("queue output names cannot collide inside a batch", () => {
  const queue = enqueueDropInputs(
    createDropQueue(),
    ["/one/movie.mp4", "/two/movie.mkv", "/three/movie.webm"],
    { outputDirectory: "/tmp/drop-output" }
  );
  assert.deepEqual(queue.jobs.map((job) => job.outputPath), [
    "/tmp/drop-output/movie.v64",
    "/tmp/drop-output/movie.2.v64",
    "/tmp/drop-output/movie.3.v64"
  ]);
});

test("source analysis derives the cell grid and discloses provisional AM1", () => {
  const job = createDropJob({ id: "drop-0001", inputPath: "speech.mp4" });
  const analysis = analyzeDropJob(job, {
    probe: () => ({
      storedWidth: 1920,
      storedHeight: 1080,
      rotationDegrees: 0,
      displayAspectRatio: 16 / 9,
      durationSeconds: 30,
      videoCodec: "h264",
      audioPresent: true,
      audioStreams: [{ index: 1, codec: "aac", channels: 2, sampleRate: 48000 }]
    })
  });
  assert.deepEqual(analysis.grid, {
    columns: 80,
    rows: 23,
    rasterWidth: 640,
    rasterHeight: 368
  });
  assert.equal(analysis.capabilities.audioEncoding, true);
  assert.match(analysis.warnings[0], /blinded listening/);
});

test("audio extraction pads or trims to the exact V64 duration", () => {
  const source = Buffer.alloc(8);
  source.writeInt16LE(100, 0);
  source.writeInt16LE(-100, 2);
  source.writeInt16LE(200, 4);
  source.writeInt16LE(-200, 6);
  let invocation = null;
  const extracted = extractDropAudioPcm("source.mp4", 10, {
    spawnSyncImpl(program, args, options) {
      invocation = { program, args, options };
      return { status: 0, stdout: source, stderr: Buffer.alloc(0), error: null };
    }
  });
  assert.equal(invocation.program, "ffmpeg");
  assert.equal(invocation.args.includes("aresample=48000:async=1:first_pts=0"), true);
  assert.equal(extracted.sourceSamples, 4);
  assert.equal(extracted.targetSamples, 8);
  assert.equal(extracted.paddedSamples, 4);
  assert.deepEqual([...extracted.samples], [100, -100, 200, -200, 0, 0, 0, 0]);
});

test("provisional AM1 encoding covers the full timeline with bounded runs", () => {
  const fixture = synthesizeAm1Fixture(48000);
  const encoded = encodeDropAudioTimeline(fixture.samples, 120000, {
    maximumRunSamples: 24000
  });
  assert.equal(encoded.summary.normative, false);
  assert.equal(encoded.summary.targetSamples, 96000);
  assert.equal(encoded.summary.audibleRuns, 3);
  assert.equal(encoded.summary.silenceSpans, 2);
  assert.equal(encoded.summary.keptSamples + encoded.summary.silenceSamples, 96000);
  assert.deepEqual(encoded.chunks.map((chunk) => chunk.type), [
    "AURN", "SILN", "AURN", "AURN", "SILN"
  ]);
  let expectedTimestamp = 0;
  for (const chunk of encoded.chunks) {
    assert.equal(chunk.timestamp, expectedTimestamp);
    expectedTimestamp += chunk.duration;
  }
  assert.equal(expectedTimestamp, 120000);
});

test("the proof encoder is invoked as an isolated child process", () => {
  let invocation = null;
  const result = encodeDropVideo("/tmp/input.mp4", "/tmp/output.v64", {
    fps: "24",
    columns: "80",
    palette: "32",
    glyphs: "32",
    profile: "balanced"
  }, {
    spawnSyncImpl(program, args, options) {
      invocation = { program, args, options };
      return {
        status: 0,
        stdout: JSON.stringify({ frames: 24, bytes: 4096 }),
        stderr: "",
        error: null
      };
    }
  });
  assert.equal(invocation.program, process.execPath);
  assert.match(invocation.args[0], /prototype\/js\/cli\.mjs$/);
  assert.deepEqual(invocation.args.slice(1, 4), [
    "encode",
    "/tmp/input.mp4",
    "/tmp/output.v64"
  ]);
  assert.deepEqual(invocation.args.slice(4), [
    "--fps", "24",
    "--columns", "80",
    "--palette", "32",
    "--glyphs", "32",
    "--profile", "balanced"
  ]);
  assert.deepEqual(result, { frames: 24, bytes: 4096 });
});

test("a Drop job encodes AM1, muxes, verifies, and reports final rates", async () => {
  const updates = [];
  const job = createDropJob({ id: "drop-0001", inputPath: "movie.mp4" });
  const result = await runDropJob(job, {
    probe: () => ({
      storedWidth: 1280,
      storedHeight: 720,
      rotationDegrees: 0,
      displayAspectRatio: 16 / 9,
      durationSeconds: 12,
      videoCodec: "h264",
      audioPresent: true,
      audioStreams: [{ index: 1, codec: "aac", channels: 2, sampleRate: 48000 }]
    }),
    encode: (input, output, options) => ({
      input,
      output,
      options,
      frames: 288,
      bytes: 4096,
      bitsPerSecond: 2731,
      bytesPerMinute: 20480,
      durationTicks: 720000
    }),
    encodeAudio: () => ({
      chunks: [{ type: "AURN" }],
      summary: {
        format: "VIDEO64-DROP-AM1-SOURCE-1",
        profile: "AM1-PROVISIONAL-8K",
        normative: false,
        sourcePresent: true,
        durationTicks: 720000,
        audibleRuns: 1,
        opusPackets: 600,
        silenceSpans: 0,
        timelineChunks: 1
      }
    }),
    mux: () => ({ bytes: 5000, audioChunks: 1, audioRuns: 1 }),
    verify: () => ({ valid: true, outputBytes: 5000, audioRuns: 1 }),
    onUpdate: (snapshot) => updates.push(snapshot)
  });
  assert.equal(result.status, "completed");
  assert.equal(result.stages.analysis.state, "completed");
  assert.equal(result.stages.video_encode.state, "completed");
  assert.equal(result.stages.audio_encode.state, "completed");
  assert.equal(result.stages.mux.state, "completed");
  assert.equal(result.stages.verify.state, "completed");
  assert.equal(result.result.encoded.options.glyphs, "32");
  assert.equal(result.result.encoded.audio.audibleRuns, 1);
  assert.equal(result.result.encoded.videoOnlyBytes, 4096);
  assert.equal(result.result.encoded.videoOnlyBitsPerSecond, 2731);
  assert.equal(result.result.encoded.videoOnlyBytesPerMinute, 20480);
  assert.equal(result.result.encoded.bytes, 5000);
  assert.equal(result.result.encoded.bitsPerSecond, 3333);
  assert.equal(result.result.encoded.bytesPerMinute, 25000);
  assert.equal(result.result.verification.audioRuns, 1);
  assert.match(result.warnings[0], /blinded listening/);
  assert.equal(updates.some((snapshot) => snapshot.stages.audio_encode.state === "running"), true);
  assert.equal(updates.some((snapshot) => snapshot.stages.verify.state === "running"), true);
});

test("a failed adapter leaves an actionable failed stage", async () => {
  const job = createDropJob({ id: "drop-0001", inputPath: "broken.mp4" });
  const result = await runDropJob(job, {
    probe: () => { throw new Error("ffprobe rejected the source"); }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.stages.analysis.state, "failed");
  assert.match(result.error, /ffprobe rejected/);
});

test("the queue runner preserves completed items and processes queued items in order", async () => {
  let queue = enqueueDropInputs(createDropQueue(), ["first.mp4", "second.mp4"]);
  const order = [];
  queue = await runDropQueue(queue, {
    probe: (input) => {
      order.push(input);
      return {
        storedWidth: 640,
        storedHeight: 360,
        rotationDegrees: 0,
        displayAspectRatio: 16 / 9,
        durationSeconds: 1,
        videoCodec: "h264",
        audioPresent: false,
        audioStreams: []
      };
    },
    encode: () => ({ frames: 24, bytes: 100, durationTicks: 60000 }),
    mux: () => ({ bytes: 100, audioChunks: 0, audioRuns: 0 }),
    verify: () => ({ valid: true, outputBytes: 100, audioRuns: 0 })
  });
  assert.deepEqual(order, [resolve("first.mp4"), resolve("second.mp4")]);
  assert.deepEqual(queue.jobs.map((job) => job.status), ["completed", "completed"]);
  assert.deepEqual(queue.jobs.map((job) => job.stages.audio_encode.state), ["skipped", "skipped"]);
  assert.deepEqual(queue.jobs.map((job) => job.result.encoded.bitsPerSecond), [800, 800]);
});
