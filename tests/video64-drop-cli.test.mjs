import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const cliPath = fileURLToPath(new URL("../apps/video64-drop/cli.mjs", import.meta.url));

test("the CLI exposes deterministic collision-safe queue planning", () => {
  const result = spawnSync(process.execPath, [
    cliPath,
    "plan",
    "/one/movie.mp4",
    "/two/movie.mkv",
    "/three/movie.webm",
    "--output-directory",
    "/tmp/video64-drop-plan",
    "--fps",
    "24",
    "--columns",
    "80",
    "--palette",
    "32",
    "--glyphs",
    "32",
    "--profile",
    "balanced"
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const queue = JSON.parse(result.stdout);
  assert.equal(queue.format, "VIDEO64-DROP-QUEUE-1");
  assert.deepEqual(queue.jobs.map((job) => job.id), [
    "drop-0001",
    "drop-0002",
    "drop-0003"
  ]);
  assert.deepEqual(queue.jobs.map((job) => job.outputPath), [
    "/tmp/video64-drop-plan/movie.v64",
    "/tmp/video64-drop-plan/movie.2.v64",
    "/tmp/video64-drop-plan/movie.3.v64"
  ]);
  assert.deepEqual(queue.settings, {
    fps: "24",
    columns: 80,
    palette: 32,
    glyphs: 32,
    profile: "balanced"
  });
});

test("the CLI plan command rejects an empty queue", () => {
  const result = spawnSync(process.execPath, [cliPath, "plan"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /at least one input/i);
});
