import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputRoot = resolve(process.argv[2] ?? join(root, "target", "fuzz-corpus"));

function hex(value) {
  return Buffer.from(value.replaceAll(/\s+/g, ""), "hex");
}

function u64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

function validAudioSeed() {
  const payload = Buffer.alloc(37);
  payload[0] = 1;
  payload[1] = 1;
  payload.writeUInt32LE(48_000, 4);
  payload.writeUInt32LE(480, 16);
  payload.writeUInt32LE(480, 20);
  payload.writeUInt32LE(1, 24);
  payload.writeUInt32LE(1, 28);
  payload.writeUInt16LE(1, 32);
  payload.writeUInt16LE(480, 34);
  payload[36] = 0;
  return Buffer.concat([u64(0), u64(600), payload]);
}

const subtitlePlane = Buffer.concat([
  hex("534d3200 02000000 02000000 0200 0000 01 01 01 01 00"),
  Buffer.alloc(16, 0xaa),
  hex("00 01"),
]);

const definitions = {
  container_parse: [
    { name: "valid-procedural.v64", source: "tests/golden/procedural.v64" },
    { name: "truncated-magic", bytes: hex("563634000d0a1a0a") },
    { name: "zero-header", bytes: Buffer.alloc(128) },
    { name: "oversized-declaration", bytes: Buffer.concat([hex("563634000d0a1a0a00018000"), Buffer.alloc(116, 0xff)]) },
  ],
  phase1_frame: [
    { name: "keyframe-repeat", bytes: hex("040001000601 03 04 000000 00") },
    { name: "delta-skip", bytes: hex("040001000600 01 04 00") },
    { name: "partial-literal", bytes: hex("040001000600 02 02 010203") },
    { name: "max-grid-end", bytes: hex("000200020d01 00") },
  ],
  grammar_b: [
    { name: "keyframe-empty", bytes: hex("020001000e01 00") },
    { name: "component-update", bytes: hex("020001000e00 04 07 07 98 00") },
    { name: "nonzero-padding", bytes: hex("010001000e01 04 40 00") },
    { name: "oversized-grid", bytes: hex("ffff ffff 00 01 00") },
  ],
  renderer: [
    { name: "one-cell", bytes: hex("0100010000 000100") },
    { name: "invalid-token", bytes: hex("0100010000 400000") },
    { name: "max-layout", bytes: hex("000200020d") },
    { name: "outside-grid", bytes: hex("0102010000") },
  ],
  subtitles: [
    { name: "full-repeat", bytes: subtitlePlane },
    { name: "repeat-bomb", bytes: Buffer.concat([hex("534d3200 02000000 ffffffff 0200 0000"), subtitlePlane.subarray(16)]) },
    { name: "truncated-entry", bytes: hex("534d3200 01000000 01000000 0200 0000 01 01 01") },
    { name: "noncanonical-varint", bytes: hex("534d3200 01000000 01000000 0200 0000 01 8100") },
  ],
  audio: [
    { name: "one-packet", bytes: validAudioSeed() },
    { name: "packet-count-bomb", bytes: Buffer.concat([u64(0), u64(600), hex("01010000 80bb0000 00000000 00000000 e0010000 e0010000 ffffffff ffffffff")]) },
    { name: "misaligned-time", bytes: Buffer.concat([u64(1), validAudioSeed().subarray(8)]) },
    { name: "truncated", bytes: Buffer.alloc(20) },
  ],
  wasm_accessors: [
    { name: "first", bytes: hex("00000000") },
    { name: "last", bytes: hex("ff7f0000") },
    { name: "boundary", bytes: hex("00800000") },
    { name: "outside", bytes: hex("01800000") },
    { name: "u32-max", bytes: hex("ffffffff") },
  ],
};

const records = [];
for (const target of Object.keys(definitions).sort()) {
  const directory = join(outputRoot, target);
  await mkdir(directory, { recursive: true });
  for (const definition of definitions[target].toSorted((a, b) => a.name.localeCompare(b.name))) {
    const bytes = definition.source
      ? await readFile(join(root, definition.source))
      : definition.bytes;
    const destination = join(directory, definition.name);
    await writeFile(destination, bytes);
    records.push({
      target,
      name: basename(destination),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      source: definition.source ?? "project-authored structural seed",
    });
  }
}

const manifest = {
  format: "V64-RUST-FUZZ-CORPUS-1",
  targets: Object.keys(definitions).sort(),
  seedCount: records.length,
  seeds: records,
};
const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(join(outputRoot, "manifest.json"), manifestBytes);
process.stdout.write(manifestBytes);
