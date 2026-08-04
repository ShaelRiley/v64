# V64

V64 is a deliberately low-fidelity audiovisual container and glyph-video codec
derived from Shael Riley's canonical **Video 64 Homebrew** alphabet in
[ANSI Tube](https://github.com/ShaelRiley/ansi-tube).

The authoritative living specification and implementation plan is the publicly
viewable
[V64 / Video64 Drop design document](https://docs.google.com/document/d/1qP6a9f6OSggPun4t1wATHRrC1yPgLngblZwlZdrk1Tg/edit?usp=sharing).
Repository files under `spec/` are implementation snapshots and experimental
bitstream notes; the linked document governs architectural intent.

## First playable prerelease

[Video 64 v0.1.0-alpha.1 — First Playable Test Release](https://github.com/ShaelRiley/v64/releases/tag/v0.1.0-alpha.1)
publishes the first real `.v64` test video and Linux x86_64 native player. The
corrected official test video is a silent 80×71-cell, 640×1136 portrait encode at
24 fps using the normative 32-color palette and primary 32-glyph `balanced`
profile. That prerelease predates later subtitle, audio, synchronization,
long-form source processing, and Video64 Drop preview work.

This repository contains a real binary `.v64` implementation, not a mock UI:

- exactly 64 original 8×16 source glyphs;
- a 32-glyph primary/default encoder budget and explicit 64-glyph option;
- all eleven legal cadences and all fourteen legal palette depths;
- deterministic source analysis, glyph matching, palette quantization,
  cell rendering, temporal hysteresis, and scene-cut-aware groups;
- a bounded, checksummed, indexed container with keyframes, deltas, skip runs,
  dictionaries, rectangle fills, repeat spans, subtitles, AM1 Opus audio, and
  exact silence;
- JavaScript encoder, decoder, inspector, verifier, and research tooling;
- stable bounded Rust decoder API, CLI, C ABI, WebAssembly renderer, fuzzing,
  hostile-input, allocation, and cross-language conformance gates;
- a Linux-first SDL2 player with subtitle/audio presentation and CRT scanlines;
- Video64 Drop application core and SDL2 shell with queueing, source analysis,
  audiovisual encoding, long-form bounded audio processing, and exact output
  verification;
- advisory sampled output-size estimation and deterministic
  source-versus-decoded-V64 preview generation.

Raw DEFLATE remains the current entropy leader. Grammar B remains experimental.
The current AM1 8 kbps speech profile remains provisional pending genuine
blinded listening.

## Requirements

- Node.js 20 or newer
- FFmpeg and FFprobe
- Rust 1.85.0 for Rust conformance and native builds

No npm dependencies are required.

## Quick start

Run the main repository gates and create the procedural sample:

```bash
npm test
npm run sample
node prototype/js/cli.mjs inspect tests/golden/procedural.v64
node prototype/js/cli.mjs verify tests/golden/procedural.v64
```

Encode any FFmpeg-readable video with the primary proof profile:

```bash
node prototype/js/cli.mjs encode input.mp4 output.v64 \
  --fps 24 --columns 80 --palette 32 --glyphs 32 --target balanced
```

Use Video64 Drop when source audio should be carried into the resulting file:

```bash
node apps/video64-drop/cli.mjs encode input.mp4 output-av.v64 \
  --fps 24 --columns 80 --palette 32 --glyphs 32 --profile balanced
```

Video64 Drop converts the first audio stream to mono 48 kHz and encodes audible
regions as AM1 `AURN` Opus runs while representing qualifying long silence as
exact `SILN` spans. Production source audio uses a bounded two-pass temporary
disk spool and keeps at most one 60-second audible run in source-PCM memory. A
permanent gate processes 47 minutes / 270,720,000 PCM bytes with a 5,760,000-byte
source-PCM buffer bound.

Estimate output size through deterministic short proof encodes:

```bash
node apps/video64-drop/cli.mjs estimate input.mp4 \
  --fps 24 --columns 80 --palette 32 --glyphs 32 --profile balanced
```

Generate lossless source, decoded-V64, and side-by-side preview images:

```bash
node apps/video64-drop/cli.mjs preview input.mp4 preview-output \
  --fps 24 --columns 80 --palette 32 --glyphs 32 --profile balanced
```

The default estimate samples three two-second regions at deterministic start,
middle, and end offsets. It reports an observed sampled-rate envelope and a
central estimate. It is advisory, not a statistical confidence interval, and
never replaces exact post-encode verification.

The preview path extracts the representative source frame with the encoder's
contain-and-pad geometry and renders the sampled `.v64` through the real decoder,
palette registry, and canonical renderer. It writes `source.ppm`,
`decoded-v64.ppm`, `comparison.ppm`, and `preview.json`.

Decode a `.v64` to conventional raster video:

```bash
node prototype/js/cli.mjs decode output.v64 decoded.mp4
```

Build and run the Linux native player or Video64 Drop shell:

```bash
cargo build --release -p v64-player --features native-ui
cargo build --release -p video64-drop-native --features native-ui
```

The SDL2 Video64 Drop window does not yet present the new estimate and preview
outputs interactively. That integration, installable Linux packaging, bundled
runtime dependencies, desktop file selection, Particle Lighting controls,
physical-device qualification, broader browser decoding, Windows/macOS
packages, and VLC integration remain active development work.

## Documentation

- [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md): latest checked state and
  active frontier.
- [`IMPLEMENTATION_LEDGER.md`](IMPLEMENTATION_LEDGER.md): historical evidence
  chain.
- [`spec/V64-v0.1-bitstream.md`](spec/V64-v0.1-bitstream.md): implemented binary
  layout.
- [`docs/NATIVE_PLAYER.md`](docs/NATIVE_PLAYER.md): native player behavior and
  evidence.
- [`docs/FUZZING.md`](docs/FUZZING.md): fuzzing and allocation ceilings.
- [`spec/V64-c-api-v1.md`](spec/V64-c-api-v1.md): stable C contract.
- [`docs/RUST_API.md`](docs/RUST_API.md): Rust ownership and CLI contract.

## Contributing and forks

Human developers, AI-assisted developers, and autonomous AI agents may choose
projects, create forks, open issues, submit pull requests, and build independent
implementations. Contributions are judged by evidence, reproducibility,
provenance, security, compatibility, and maintainability rather than contributor
type.

Read [`CONTRIBUTING.md`](CONTRIBUTING.md), [`GOVERNANCE.md`](GOVERNANCE.md),
[`AGENTS.md`](AGENTS.md), and [`SECURITY.md`](SECURITY.md) before contributing.

## License and authorship

Video 64 is released under the attribution-preserving [MIT License](LICENSE),
SPDX identifier `MIT`, with `Copyright (c) 2026 Shael Riley`.

Anyone may use, copy, modify, merge, publish, distribute, sublicense, sell, fork,
port, or independently reimplement the project without requesting permission.
The copyright and permission notice must remain in copies or substantial
portions. The canonical Video 64 masks originated in ANSI Tube and were created
by Shael Riley.
