#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { applyPackedCommandsDirect } from "../prototype/js/grammar-b-direct.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: decode-grammar-b-fixture.mjs INPUT.bin OUTPUT.bin");
}

const input = readFileSync(inputPath);
if (input.length < 20 || input.subarray(0, 8).toString("ascii") !== "V64GBD1\0") {
  throw new Error("Grammar B fixture magic mismatch");
}
const columns = input.readUInt16LE(8);
const rows = input.readUInt16LE(10);
const paletteDepth = input.readUInt16LE(12);
if (input.readUInt16LE(14) !== 0) throw new Error("Nonzero Grammar B fixture reserved field");
const frameCount = input.readUInt32LE(16);
let offset = 20;
let prior = null;
const frames = [];

for (let index = 0; index < frameCount; index += 1) {
  if (offset + 24 > input.length) throw new Error("Truncated Grammar B fixture record");
  const timestamp = Number(input.readBigUInt64LE(offset));
  const duration = Number(input.readBigUInt64LE(offset + 8));
  const flags = input[offset + 16];
  if (flags & ~3) throw new Error("Unknown Grammar B fixture flags");
  if (input.readUIntLE(offset + 17, 3) !== 0) throw new Error("Nonzero Grammar B record reserved field");
  const commandLength = input.readUInt32LE(offset + 20);
  offset += 24;
  if (offset + commandLength > input.length) throw new Error("Truncated Grammar B command stream");
  const commands = input.subarray(offset, offset + commandLength);
  offset += commandLength;
  const keyframe = Boolean(flags & 1);
  const repeat = Boolean(flags & 2);
  if (repeat) {
    if (keyframe || commandLength || !prior) throw new Error("Invalid Grammar B repeat record");
  } else {
    prior = applyPackedCommandsDirect(commands, prior, {
      columns,
      rows,
      paletteDepth,
      keyframe
    });
  }
  frames.push({ timestamp, duration, keyframe, repeat, state: Buffer.from(prior) });
}
if (offset !== input.length) throw new Error("Trailing Grammar B fixture bytes");

const parts = [];
const header = Buffer.alloc(16);
header.write("V64GOLD1", 0, 8, "ascii");
header.writeUInt16LE(columns, 8);
header.writeUInt16LE(rows, 10);
header.writeUInt32LE(frames.length, 12);
parts.push(header);
for (const frame of frames) {
  const record = Buffer.alloc(24);
  record.writeBigUInt64LE(BigInt(frame.timestamp), 0);
  record.writeBigUInt64LE(BigInt(frame.duration), 8);
  record[16] = frame.keyframe ? 1 : 0;
  record[17] = frame.repeat ? 1 : 0;
  record.writeUInt16LE(0, 18);
  record.writeUInt32LE(frame.state.length, 20);
  parts.push(record, frame.state);
}
writeFileSync(outputPath, Buffer.concat(parts));
