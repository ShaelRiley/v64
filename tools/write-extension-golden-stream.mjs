#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import {
  decodeAudioTimeline,
  decodeSubtitleTimeline,
  demuxV64
} from "../prototype/js/container.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: write-extension-golden-stream.mjs INPUT.v64 OUTPUT.bin");
}

const demuxed = demuxV64(readFileSync(inputPath));
const subtitleTimeline = decodeSubtitleTimeline(demuxed);
const audioTimeline = decodeAudioTimeline(demuxed);
const subtitleChunks = subtitleTimeline?.chunks ?? [];
const audioItems = audioTimeline?.timeline ?? [];
const parts = [];

const header = Buffer.alloc(24);
header.write("V64EXT1\0", 0, 8, "ascii");
header.writeUInt16LE(demuxed.header.columns, 8);
header.writeUInt16LE(demuxed.header.rows, 10);
header.writeUInt32LE(demuxed.header.cadence.frameTicks, 12);
header.writeUInt32LE(subtitleChunks.length, 16);
header.writeUInt32LE(audioItems.length, 20);
parts.push(header);

for (const chunk of subtitleChunks) {
  const chunkHeader = Buffer.alloc(28);
  chunkHeader.writeBigUInt64LE(BigInt(chunk.timestamp), 0);
  chunkHeader.writeBigUInt64LE(BigInt(chunk.duration), 8);
  chunkHeader.writeUInt32LE(chunk.sequence.frames.length, 16);
  chunkHeader.writeUInt32LE(chunk.sequence.cellCount, 20);
  chunkHeader.writeUInt16LE(chunk.sequence.paletteDepth, 24);
  chunkHeader.writeUInt16LE(0, 26);
  parts.push(chunkHeader);

  for (const frame of chunk.sequence.frames) {
    const frameHeader = Buffer.alloc(4);
    frameHeader.writeUInt32LE(frame.length, 0);
    parts.push(frameHeader);
    for (const entry of frame) {
      const record = Buffer.alloc(22);
      record.writeUInt32LE(entry.cellIndex, 0);
      record[4] = entry.foreground;
      record[5] = entry.background;
      Buffer.from(entry.mask).copy(record, 6);
      parts.push(record);
    }
  }
}

for (const item of audioItems) {
  const record = Buffer.alloc(44);
  record[0] = item.type === "AURN" ? 0 : 1;
  record.writeBigUInt64LE(BigInt(item.timestamp), 4);
  record.writeBigUInt64LE(BigInt(item.duration), 12);
  if (item.type === "AURN") {
    record.writeUInt32LE(item.preSkip, 20);
    record.writeUInt32LE(item.endTrim, 24);
    record.writeUInt32LE(item.keptSamples, 28);
    record.writeUInt32LE(item.decodedSamples, 32);
    record.writeUInt32LE(item.packets.length, 36);
    record.writeUInt32LE(item.packetDataBytes, 40);
  }
  parts.push(record);

  if (item.type === "AURN") {
    for (let index = 0; index < item.packets.length; index += 1) {
      const packet = Buffer.from(item.packets[index]);
      const packetHeader = Buffer.alloc(4);
      packetHeader.writeUInt16LE(packet.length, 0);
      packetHeader.writeUInt16LE(item.packetSamples[index], 2);
      parts.push(packetHeader, packet);
    }
  }
}

writeFileSync(outputPath, Buffer.concat(parts));
