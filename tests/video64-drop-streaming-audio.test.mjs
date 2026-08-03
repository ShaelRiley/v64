import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  encodeDropAudioFileTimeline,
  encodeDropAudioTimeline,
  extractDropAudioPcmFile
} from "../apps/video64-drop/audio.mjs";
import {
  createSilenceSpanDetector,
  detectSilenceSpans,
  synthesizeAm1Fixture
} from "../prototype/js/audio-am1.mjs";

function pcm16Bytes(samples) {
  const output = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    output.writeInt16LE(samples[index], index * 2);
  }
  return output;
}

function withTemporaryDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), "video64-drop-stream-test-"));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("stateful silence detection is identical across arbitrary chunk boundaries", () => {
  const fixture = synthesizeAm1Fixture(48000);
  const options = {
    sampleRate: 48000,
    windowMs: 10,
    enterDb: -48,
    exitDb: -42,
    minimumSilenceMs: 120,
    hangoverMs: 40
  };
  const expected = detectSilenceSpans(fixture.samples, options);
  const detector = createSilenceSpanDetector(options);
  const chunkSizes = [1, 479, 480, 777, 8192, 13, 4097, 960, 31];
  let cursor = 0;
  let chunkIndex = 0;
  while (cursor < fixture.samples.length) {
    const end = Math.min(
      fixture.samples.length,
      cursor + chunkSizes[chunkIndex % chunkSizes.length]
    );
    detector.push(fixture.samples.slice(cursor, end));
    cursor = end;
    chunkIndex += 1;
  }
  const streamed = detector.finish();
  assert.deepEqual(streamed, expected);
  assert.deepEqual(detector.finish(), expected);
  assert.throws(() => detector.push(Int16Array.of(0)), /already finished/);
});

test("file extraction pads exact duration without buffering stdout", () => {
  withTemporaryDirectory((directory) => {
    const outputPath = join(directory, "source.pcm");
    const source = Buffer.alloc(8);
    source.writeInt16LE(100, 0);
    source.writeInt16LE(-100, 2);
    source.writeInt16LE(200, 4);
    source.writeInt16LE(-200, 6);
    let invocation = null;
    const extracted = extractDropAudioPcmFile(
      "source.mp4",
      10,
      outputPath,
      {
        spawnSyncImpl(program, args, options) {
          invocation = { program, args, options };
          writeFileSync(args.at(-1), source);
          return {
            status: 0,
            stdout: Buffer.alloc(0),
            stderr: Buffer.alloc(0),
            error: null
          };
        }
      }
    );
    assert.equal(invocation.program, "ffmpeg");
    assert.equal(invocation.args.at(-1), outputPath);
    assert.equal(invocation.options.maxBuffer, 8 * 1024 * 1024);
    assert.equal(extracted.sourceSamples, 4);
    assert.equal(extracted.targetSamples, 8);
    assert.equal(extracted.paddedSamples, 4);
    assert.equal(extracted.trimmedSamples, 0);
    assert.equal(extracted.spoolBytes, 16);
    assert.equal(statSync(outputPath).size, 16);
    assert.deepEqual([...readFileSync(outputPath).subarray(8)], new Array(8).fill(0));
  });
});

test("disk-spooled AM1 matches in-memory encoding with bounded PCM reads", () => {
  withTemporaryDirectory((directory) => {
    const fixture = synthesizeAm1Fixture(48000);
    const pcmPath = join(directory, "fixture.pcm");
    writeFileSync(pcmPath, pcm16Bytes(fixture.samples));
    const options = {
      maximumRunSamples: 24000,
      scanReadBytes: 1000
    };
    const memory = encodeDropAudioTimeline(fixture.samples, 120000, options);
    const streamed = encodeDropAudioFileTimeline(pcmPath, 120000, options);
    assert.deepEqual(streamed.chunks, memory.chunks);
    assert.equal(streamed.summary.strategy, "disk-spooled-two-pass");
    assert.equal(streamed.summary.streaming, true);
    assert.equal(streamed.summary.wholeFilePcmBuffered, false);
    assert.equal(streamed.summary.scanReadBytes, 1000);
    assert.equal(streamed.summary.maximumRunPcmBytes, 48000);
    assert.equal(streamed.summary.maximumSourcePcmWorkingSetBytes, 48000);
    assert.equal(streamed.summary.spoolBytes, 192000);
    assert.equal(streamed.summary.targetSamples, 96000);
    assert.equal(streamed.summary.audibleRuns, memory.summary.audibleRuns);
    assert.equal(streamed.summary.silenceSpans, memory.summary.silenceSpans);
    assert.equal(streamed.summary.payloadBytes, memory.summary.payloadBytes);
  });
});
