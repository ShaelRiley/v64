import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

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
  runDropJob,
  runDropQueue
} from "../apps/video64-drop/runner.mjs";

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

test("source analysis derives the cell grid and discloses silent output", () => {
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
  assert.equal(analysis.capabilities.audioEncoding, false);
  assert.match(analysis.warnings[0], /silent proof encoder/);
});

test("a Drop job drives the real stage contract and verifies its output", async () => {
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
      bytes: 4096
    }),
    verify: () => ({ valid: true, outputBytes: 4096 }),
    onUpdate: (snapshot) => updates.push(snapshot)
  });
  assert.equal(result.status, "completed");
  assert.equal(result.stages.analysis.state, "completed");
  assert.equal(result.stages.video_encode.state, "completed");
  assert.equal(result.stages.audio_encode.state, "skipped");
  assert.equal(result.stages.mux.state, "completed");
  assert.equal(result.stages.verify.state, "completed");
  assert.equal(result.result.encoded.options.glyphs, "32");
  assert.equal(result.result.verification.valid, true);
  assert.match(result.warnings[0], /audio is not written/);
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
    encode: () => ({ frames: 24, bytes: 100 }),
    verify: () => ({ valid: true, outputBytes: 100 })
  });
  assert.deepEqual(order, [resolve("first.mp4"), resolve("second.mp4")]);
  assert.deepEqual(queue.jobs.map((job) => job.status), ["completed", "completed"]);
});
