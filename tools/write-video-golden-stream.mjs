#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { demuxV64, decodeVideoTimeline } from "../prototype/js/container.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: write-video-golden-stream.mjs INPUT.v64 OUTPUT.bin");
}

const demuxed = demuxV64(readFileSync(inputPath));
const timeline = decodeVideoTimeline(demuxed);
const parts = [];
const header = Buffer.alloc(16);
header.write("V64GOLD1", 0, 8, "ascii");
header.writeUInt16LE(demuxed.header.columns, 8);
header.writeUInt16LE(demuxed.header.rows, 10);
header.writeUInt32LE(timeline.length, 12);
parts.push(header);

for (const item of timeline) {
  const record = Buffer.alloc(24);
  record.writeBigUInt64LE(BigInt(item.timestamp), 0);
  record.writeBigUInt64LE(BigInt(item.duration), 8);
  record[16] = item.keyframe ? 1 : 0;
  record[17] = item.repeat ? 1 : 0;
  record.writeUInt16LE(0, 18);
  record.writeUInt32LE(item.state.length, 20);
  parts.push(record, Buffer.from(item.state));
}

writeFileSync(outputPath, Buffer.concat(parts));
