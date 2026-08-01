# Checked browser two-second seek gate

Status: **passed**

Checked code head: `a53109205a6effc0ab0e4c4bcf15ae8388ba88d0`

GitHub Actions workflow: `30599518584` (`V64 browser two-second seek conformance`)

Artifact: `browser-two-second-seek-conformance`, ID `8781381629`

## Result

Headless Chrome independently parsed an uncompressed V64 proof file, used its
seek index to reconstruct frames from the nearest keyframe, decoded canonical
SM2 subtitle sequences, rendered the base and subtitle composite, applied
viewport-anchored CRT scanlines, sliced the companion 48 kHz PCM timeline, and
compared every result with hashes produced by the canonical Node implementation.

The clean workflow passed all **101** repository tests and all browser checks.
Thirteen out-of-order seeks across eight unique frames were byte-stable,
including repeated seeks, the end of the first two-second group, the first two
frames of the second group, the frame immediately before a subtitle transition,
and the final frame.

## Deterministic fixture

- container: `browser-seek.v64`
- container bytes: **1,500**
- container SHA-256:
  `fb718b18ca33daee5626e2d3727e47f2393a3b8f74db5b38b20fcd40311aa1e1`
- feature flags: `0x99`
- cadence: **24 fps**
- frame duration: **2,500 ticks**
- total duration: **240,000 ticks / 4 seconds**
- video frames: **96**
- independent groups: **2 × 48 frames / 2 seconds**
- keyframes: **2**
- repeat spans: **12**
- subtitle chunks: **2**
- subtitle frames: **96**
- grid: **4 × 2 cells**
- palette depth: **16**

Companion browser PCM golden timeline:

- sample rate: **48 kHz mono**
- samples: **192,000**
- bytes: **384,000**
- SHA-256:
  `8846750d2fe20c1c86ca9c3a37b1d6f28cf8471719e99e7d688fef3d9eec9310`

The PCM file tests browser-side seek slicing. Standard Opus packet decode,
`AURN` trim accounting, exact `SILN`, and full/repeated audio seek decoding are
covered independently by the checked AM1 playback gate.

## Browser seek sequence

`0, 47, 48, 49, 95, 48, 0, 72, 73, 24, 73, 47, 95`

This sequence contains thirteen seeks to eight unique frames and deliberately
jumps backward and forward across the two-second group boundary.

For every seek Chrome reproduced the Node-derived SHA-256 values for:

- decoded cell state;
- active subtitle plane;
- base-plus-subtitle RGBA composite;
- viewport-anchored scanline RGBA output;
- exact 2,000-sample PCM frame window.

Repeated targets produced identical result objects. No prior seek or prior-group
state was carried into independent reconstruction.

## Scanline behavior

The fixture uses the shared playback profile:

- enabled: **true**;
- strength: **0.18**;
- period: **2**;
- phase: **1**;
- viewport Y: **3**.

Both the canonical implementation and the browser implementation calculate
phase from viewport coordinates rather than image-local coordinates. Scanlines
remain presentation-only and do not modify decoded state.

## Decision

The retained **two-second independent group duration is frozen for the
JavaScript proof profile**. The browser gate demonstrates deterministic indexed
reconstruction at and across group boundaries for video cells, subtitle planes,
composited raster output, audio windows, and viewport-anchored scanlines.

Future Rust, WebAssembly, native-player, and VLC implementations must reproduce
the same golden semantics before this duration is promoted into the final V1
cross-implementation profile.
