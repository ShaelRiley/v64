#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  detectSilenceSpans,
  encodePcm16Wav,
  silenceSpansToChunks,
  synthesizeAm1Fixture
} from "../prototype/js/audio-am1.mjs";
import { encodeSegmentedAm1Runs } from "../prototype/js/audio-opus.mjs";

const outputDirectory = resolve(process.argv[2] || "bench/generated/am1");
mkdirSync(outputDirectory, { recursive: true });

const fixture = synthesizeAm1Fixture(48000);
const wav = encodePcm16Wav(fixture.samples, fixture.sampleRate, fixture.channels);
const detected = detectSilenceSpans(fixture.samples, {
  sampleRate: fixture.sampleRate,
  windowMs: 10,
  enterDb: -48,
  exitDb: -42,
  minimumSilenceMs: 120,
  hangoverMs: 40
});
const chunks = silenceSpansToChunks(detected.spans, fixture.sampleRate);
const runs = encodeSegmentedAm1Runs(
  fixture.samples,
  fixture.sampleRate,
  detected.spans,
  { bitrateKbps: 8, frameDurationMs: 20 }
);
const runManifest = runs.map((run, index) => {
  const filename = `run-${String(index).padStart(2, "0")}.opuspackets`;
  writeFileSync(resolve(outputDirectory, filename), run.packetStreamBytes);
  return {
    filename,
    startSample: run.startSample,
    endSample: run.endSample,
    timestamp: run.timestamp,
    duration: run.duration,
    preSkip: run.preSkip,
    endTrim: run.endTrim,
    keptSamples: run.keptSamples,
    decodedSamples: run.decodedSamples,
    packets: run.packets.length,
    packetSamples: run.packetSamples,
    packetStreamBytes: run.packetStreamBytes.length,
    packetStreamSha256: run.packetStreamSha256
  };
});
const silenceSamples = detected.spans.reduce(
  (sum, span) => sum + span.endSample - span.startSample,
  0
);
const accountedSamples = silenceSamples + runManifest.reduce(
  (sum, run) => sum + run.keptSamples,
  0
);
const manifest = {
  format: "V64-AM1-FIXTURE-2",
  sampleRate: fixture.sampleRate,
  channels: fixture.channels,
  samples: fixture.samples.length,
  durationSeconds: fixture.samples.length / fixture.sampleRate,
  wavBytes: wav.length,
  wavSha256: createHash("sha256").update(wav).digest("hex"),
  segments: fixture.segments,
  detector: detected.diagnostics,
  silenceSpans: detected.spans,
  silenceChunks: chunks.map((chunk) => ({
    type: chunk.type,
    timestamp: chunk.timestamp,
    duration: chunk.duration,
    payloadBytes: chunk.payload.length
  })),
  opus: {
    application: "voip",
    bitrateKbps: 8,
    constrainedVbr: true,
    frameDurationMs: 20,
    dtx: false,
    fec: false,
    runs: runManifest,
    silenceSamples,
    accountedSamples
  }
};

writeFileSync(resolve(outputDirectory, "am1-hysteresis.wav"), wav);
writeFileSync(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
console.log(JSON.stringify(manifest, null, 2));
