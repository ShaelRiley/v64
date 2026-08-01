#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { demuxV64, decodeVideoTimeline } from "../prototype/js/container.mjs";
import { buildCommandTrace, encodePackedCommands } from "../prototype/js/grammar-b.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: write-grammar-b-fixture.mjs INPUT.v64 OUTPUT.bin");
}

const demuxed = demuxV64(readFileSync(inputPath));
const timeline = decodeVideoTimeline(demuxed);
const parts = [];
const header = Buffer.alloc(20);
header.write("V64GBD1\0", 0, 8, "ascii");
header.writeUInt16LE(demuxed.header.columns, 8);
header.writeUInt16LE(demuxed.header.rows, 10);
header.writeUInt16LE(demuxed.header.paletteDepth, 12);
header.writeUInt16LE(0, 14);
header.writeUInt32LE(timeline.length, 16);
parts.push(header);

let prior = null;
for (const item of timeline) {
  let commands = Buffer.alloc(0);
  if (!item.repeat) {
    const trace = buildCommandTrace(item.state, prior, {
      columns: demuxed.header.columns,
      rows: demuxed.header.rows,
      paletteDepth: demuxed.header.paletteDepth,
      keyframe: item.keyframe
    });
    commands = encodePackedCommands(trace);
  }
  const record = Buffer.alloc(24);
  record.writeBigUInt64LE(BigInt(item.timestamp), 0);
  record.writeBigUInt64LE(BigInt(item.duration), 8);
  record[16] = (item.keyframe ? 1 : 0) | (item.repeat ? 2 : 0);
  record.writeUIntLE(0, 17, 3);
  record.writeUInt32LE(commands.length, 20);
  parts.push(record, commands);
  prior = item.state;
}

writeFileSync(outputPath, Buffer.concat(parts));
