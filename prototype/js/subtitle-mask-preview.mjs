import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { rasterizeSubtitleMaskPlane } from "./subtitle-mask.mjs";

const CELL_WIDTH = 8;
const CELL_HEIGHT = 16;

function assertImage(image, label) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      !Buffer.isBuffer(image.rgba) || image.rgba.length !== image.width * image.height * 4) {
    throw new TypeError(`${label} must be a complete RGBA image`);
  }
}

export function compositeSubtitleMaskPlane(baseImage, decoded, columns, rows, palette) {
  assertImage(baseImage, "Subtitle-mask base image");
  const expectedWidth = columns * CELL_WIDTH;
  const expectedHeight = rows * CELL_HEIGHT;
  if (baseImage.width !== expectedWidth || baseImage.height !== expectedHeight) {
    throw new RangeError("Subtitle-mask base image does not match the declared grid");
  }

  const overlay = rasterizeSubtitleMaskPlane(decoded, columns, rows, palette);
  const rgba = Buffer.from(baseImage.rgba);
  for (const entry of decoded.entries) {
    const cx = entry.cellIndex % columns;
    const cy = Math.floor(entry.cellIndex / columns);
    for (let py = 0; py < CELL_HEIGHT; py += 1) {
      const sourceOffset = (((cy * CELL_HEIGHT + py) * expectedWidth) + cx * CELL_WIDTH) * 4;
      overlay.rgba.copy(rgba, sourceOffset, sourceOffset, sourceOffset + CELL_WIDTH * 4);
    }
  }
  return { width: expectedWidth, height: expectedHeight, rgba };
}

export function measureSubtitleMaskPlanes(planes) {
  if (!Array.isArray(planes) || planes.some((plane) => !Buffer.isBuffer(plane))) {
    throw new TypeError("Subtitle-mask measurements require an array of buffers");
  }
  const framed = [];
  let payloadBytes = 0;
  const hashes = [];
  for (const plane of planes) {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(plane.length);
    framed.push(length, plane);
    payloadBytes += plane.length;
    hashes.push(createHash("sha256").update(plane).digest("hex"));
  }
  const stream = Buffer.concat(framed);
  const deflateBytes = deflateRawSync(stream, { level: 9 }).length;
  let changedPlanes = 0;
  for (let index = 1; index < hashes.length; index += 1) {
    if (hashes[index] !== hashes[index - 1]) changedPlanes += 1;
  }
  return {
    frames: planes.length,
    payloadBytes,
    framingBytes: planes.length * 4,
    framedBytes: stream.length,
    deflateBytes,
    uniquePlanes: new Set(hashes).size,
    changedPlanes,
    sha256: createHash("sha256").update(stream).digest("hex")
  };
}
