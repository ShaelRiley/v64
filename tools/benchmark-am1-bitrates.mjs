#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodePcm16Wav } from "../prototype/js/audio-am1.mjs";
import {
  analyzePcmSegments,
  comparePcm,
  preprocessAm1Wav,
  synthesizeAm1PreprocessFixture
} from "../prototype/js/audio-preprocess.mjs";
import { encodeAm1OpusOgg } from "../prototype/js/audio-opus.mjs";
import { encodeAurnPayload } from "../prototype/js/audio-run.mjs";
import { decodeAurnRunToPcm } from "../prototype/js/audio-decode.mjs";

const outputDirectory = resolve(process.argv[2] || "bench/results/am1-bitrate-sweep");
mkdirSync(outputDirectory, { recursive: true });
const BITRATES = Object.freeze([4, 8, 12, 16]);

function pcmBufferToSamples(input) {
  const bytes = Buffer.from(input);
  if (bytes.length % 2) throw new Error("Decoded PCM byte count is odd");
  const samples = new Int16Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2);
  }
  return samples;
}

function blindCode(bitrateKbps) {
  return createHash("sha256")
    .update(`V64-AM1-BITRATE-SWEEP-1\0${bitrateKbps}`)
    .digest("hex").slice(0, 8).toUpperCase();
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const fixture = synthesizeAm1PreprocessFixture(44100);
const processed = preprocessAm1Wav(fixture.wav);
const processedHash = createHash("sha256").update(processed.wav).digest("hex");
const segmentMetrics = analyzePcmSegments(
  processed.samples,
  processed.sampleRate,
  fixture.segments
);
writeFileSync(resolve(outputDirectory, "source-stereo-44100.wav"), fixture.wav);
writeFileSync(resolve(outputDirectory, "reference-am1-preprocessed.wav"), processed.wav);

const publicRows = [];
const keyRows = [];
for (const bitrateKbps of BITRATES) {
  const encoded = encodeAm1OpusOgg(processed.wav, {
    bitrateKbps,
    frameDurationMs: 20
  });
  const decoded = decodeAurnRunToPcm(encoded);
  const decodedSamples = pcmBufferToSamples(decoded.pcm);
  if (decodedSamples.length !== processed.samples.length) {
    throw new Error(`Decoded sample count mismatch at ${bitrateKbps} kbit/s`);
  }
  const comparison = comparePcm(processed.samples, decodedSamples);
  const aurnPayload = encodeAurnPayload(encoded);
  const packetDataBytes = encoded.packets.reduce(
    (sum, packet) => sum + packet.length,
    0
  );
  const packetRateKbps = packetDataBytes * 8 /
    (processed.samples.length / processed.sampleRate) / 1000;
  const aurnRateKbps = aurnPayload.length * 8 /
    (processed.samples.length / processed.sampleRate) / 1000;
  const code = blindCode(bitrateKbps);
  const filename = `${code}.wav`;
  const wav = encodePcm16Wav(decodedSamples, 48000, 1);
  writeFileSync(resolve(outputDirectory, filename), wav);
  publicRows.push({
    code,
    filename,
    bytes: wav.length,
    sha256: createHash("sha256").update(wav).digest("hex")
  });
  keyRows.push({
    code,
    bitrateKbps,
    packets: encoded.packets.length,
    packetDataBytes,
    packetStreamBytes: encoded.packetStreamBytes.length,
    packetStreamSha256: encoded.packetStreamSha256,
    aurnPayloadBytes: aurnPayload.length,
    packetRateKbps: Number(packetRateKbps.toFixed(3)),
    aurnRateKbps: Number(aurnRateKbps.toFixed(3)),
    preSkip: encoded.preSkip,
    endTrim: encoded.endTrim,
    keptSamples: encoded.keptSamples,
    decodedPcmSha256: decoded.sha256,
    comparison
  });
}
publicRows.sort((a, b) => a.code.localeCompare(b.code));

const worksheet = [[
  "code",
  "speech_band_naturalness_1_to_5",
  "tonal_artifacts_1_to_5",
  "quiet_segment_preservation_1_to_5",
  "overall_preference_rank_1_to_4",
  "notes"
].join(",")];
for (const row of publicRows) {
  worksheet.push([row.code, "", "", "", "", ""].map(csv).join(","));
}

writeFileSync(resolve(outputDirectory, "worksheet.csv"), `${worksheet.join("\n")}\n`);
writeFileSync(resolve(outputDirectory, "public-manifest.json"), `${JSON.stringify({
  format: "V64-AM1-BITRATE-REVIEW-PUBLIC-1",
  reference: {
    filename: "reference-am1-preprocessed.wav",
    samples: processed.samples.length,
    sampleRate: processed.sampleRate,
    channels: processed.channels,
    sha256: processedHash
  },
  variants: publicRows
}, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "preprocess-summary.json"), `${JSON.stringify({
  format: "V64-AM1-PREPROCESS-SUMMARY-1",
  source: {
    sampleRate: fixture.sampleRate,
    channels: fixture.channels,
    samples: fixture.samples.length,
    wavBytes: fixture.wav.length,
    wavSha256: createHash("sha256").update(fixture.wav).digest("hex")
  },
  output: {
    sampleRate: processed.sampleRate,
    channels: processed.channels,
    samples: processed.samples.length,
    wavBytes: processed.wav.length,
    wavSha256: processedHash,
    filter: processed.filter,
    segmentMetrics
  }
}, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "key.json"), `${JSON.stringify({
  format: "V64-AM1-BITRATE-REVIEW-KEY-1",
  warning: "Keep concealed until listening scores are committed.",
  referenceSha256: processedHash,
  variants: keyRows
}, null, 2)}\n`);

console.log(JSON.stringify({
  format: "V64-AM1-BITRATE-SWEEP-BUILD-1",
  outputDirectory,
  referenceSha256: processedHash,
  variants: publicRows.length
}, null, 2));
