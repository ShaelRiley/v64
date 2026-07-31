export function opusPacketSamples(packetInput) {
  const packet = Buffer.from(packetInput);
  if (!packet.length) throw new Error("Empty Opus packet");
  const toc = packet[0];
  const config = toc >>> 3;
  const samplesPerFrame = config < 12
    ? [480, 960, 1920, 2880][config & 3]
    : config < 16
      ? [480, 960][config & 1]
      : [120, 240, 480, 960][config & 3];
  const code = toc & 3;
  let frames;
  if (code === 0) frames = 1;
  else if (code === 1 || code === 2) frames = 2;
  else {
    if (packet.length < 2) throw new Error("Truncated Opus frame-count byte");
    frames = packet[1] & 0x3f;
  }
  if (frames < 1 || frames * samplesPerFrame > 5760) {
    throw new Error("Invalid Opus packet duration");
  }
  return frames * samplesPerFrame;
}
