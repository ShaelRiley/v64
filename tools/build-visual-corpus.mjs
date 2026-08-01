#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STILLS = resolve(ROOT, "bench/corpus/sources/stills");
const VIDEO = resolve(ROOT, "bench/corpus/sources/video");
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const FIXTURES = Object.freeze([
  {
    id: "fictional-lecture-speaker",
    input: "fictional-lecture-speaker.png",
    output: "fictional-lecture-speaker.mp4",
    filter: [
      "scale=720:405:force_original_aspect_ratio=increase",
      "crop=720:405",
      "zoompan=z='1.025+0.025*sin(on*PI/72)':x='iw/2-(iw/zoom/2)+2*sin(on*PI/18)':y='ih/2-(ih/zoom/2)+1.5*cos(on*PI/22)':d=1:s=640x360:fps=24",
      `drawtext=fontfile=${FONT}:text='WE KEEP THE SIGNAL.':fontcolor=white:fontsize=26:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-48:enable='between(t,0.75,2.75)'`
    ].join(",")
  },
  {
    id: "fictional-saturated-performance",
    input: "fictional-saturated-performance.png",
    output: "fictional-saturated-performance.mp4",
    filter: [
      "scale=760:428:force_original_aspect_ratio=increase",
      "crop=760:428",
      "zoompan=z='1.04+0.055*sin(on*PI/28)':x='iw/2-(iw/zoom/2)+10*sin(on*PI/17)':y='ih/2-(ih/zoom/2)+5*cos(on*PI/21)':d=1:s=640x360:fps=24",
      "eq=saturation='1.0+0.12*sin(2*PI*t/1.25)':contrast=1.04"
    ].join(",")
  },
  {
    id: "fictional-animated-dialogue",
    input: "fictional-animated-dialogue.png",
    output: "fictional-animated-dialogue.mp4",
    filter: [
      "scale=720:405:force_original_aspect_ratio=increase",
      "crop=720:405",
      "zoompan=z='1.015+0.018*sin(on*PI/60)':x='iw/2-(iw/zoom/2)+4*sin(on*PI/36)':y='ih/2-(ih/zoom/2)':d=1:s=640x360:fps=24",
      `drawtext=fontfile=${FONT}:text='NOTHING IMPORTANT SHOULD DISAPPEAR.':fontcolor=white:fontsize=23:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-47:enable='between(t,0.5,2.8)'`
    ].join(",")
  }
]);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runFfmpeg(fixture) {
  const input = resolve(STILLS, fixture.input);
  const output = resolve(VIDEO, fixture.output);
  const result = spawnSync("ffmpeg", [
    "-y", "-v", "error",
    "-loop", "1", "-framerate", "24", "-i", input,
    "-t", "3",
    "-vf", fixture.filter,
    "-an",
    "-c:v", "libx264",
    "-preset", "veryslow",
    "-crf", "12",
    "-pix_fmt", "yuv420p",
    "-threads", "1",
    "-map_metadata", "-1",
    "-fflags", "+bitexact",
    "-flags:v", "+bitexact",
    output
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${fixture.id}: ${result.stderr.trim()}`);
  }
  return {
    id: fixture.id,
    input: `bench/corpus/sources/stills/${fixture.input}`,
    inputSha256: sha256(input),
    output: `bench/corpus/sources/video/${fixture.output}`,
    outputSha256: sha256(output),
    bytes: statSync(output).size,
    filter: fixture.filter
  };
}

mkdirSync(VIDEO, { recursive: true });
console.log(JSON.stringify({
  format: "V64-VISUAL-CORPUS-BUILD-1",
  note: "Committed output hashes are normative; FFmpeg encoder bytes can vary by build.",
  fixtures: FIXTURES.map(runFfmpeg)
}, null, 2));
