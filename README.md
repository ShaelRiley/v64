# V64

V64 is a deliberately low-fidelity audiovisual container and glyph-video codec
derived from Shael Riley's canonical **Video 64 Homebrew** alphabet in
[ANSI Tube](https://github.com/ShaelRiley/ansi-tube).

The authoritative living specification and implementation plan is the publicly
viewable
[V64 / Video64 Drop design document](https://docs.google.com/document/d/1qP6a9f6OSggPun4t1wATHRrC1yPgLngblZwlZdrk1Tg/edit?usp=sharing).
Repository files under `spec/` are implementation snapshots and experimental
bitstream notes; the linked document governs architectural intent.

This repository currently contains the executable Phase 1 proof codec. It is a
real binary `.v64` implementation, not a mock UI:

- exact extracted 64-glyph `8×16` source asset and immutable SHA-256 identity;
- a **32-glyph primary/default encoding budget**, with the complete 64-glyph
  alphabet available as an explicit option;
- all eleven legal cadences and all fourteen legal palette depths;
- deterministic source-pixel analysis, glyph matching, palette quantization,
  cell rendering, and temporal hysteresis;
- scene-cut-aware independent groups with a frozen two-second maximum;
- explicit compact, balanced, and quality rate-distortion targets;
- a bounded, checksummed, indexed binary container;
- keyframes, delta frames, skip runs, repeated-token runs, rectangle fills,
  local token dictionaries, and repeat-frame spans;
- sparse particle-event and exact-silence chunk definitions;
- FFmpeg-backed source ingest and decoded MP4/MKV output;
- encoder, decoder, inspector, verifier, atlas generator, and sample generator;
- an experimental backend-neutral Grammar B trace with packed palette indices,
  separable component updates, transactional decoding, and exact byte accounting;
- reproducible packed-only, DEFLATE, Zstandard, and canonical-Huffman command
  shootouts on identical traces and independent-group boundaries;
- a provenance-validated, deterministic structural seed corpus spanning eleven
  visual classes and a two-pass static-byte entropy parser with actual-DEFLATE
  candidate selection;
- hash-validated FFmpeg raster-corpus paths, including deterministic source-plate
  treatments that avoid opaque derived-video fixtures;
- reproducible Hyper Real-derived 256-color palette candidates preserving ANSI
  Tube's exact saturated anchors;
- original CC0 human-content tranches with matched palette previews, temporal
  metrics, independent-group seek/size sweeps, 60/80-column subtitle lanes, and
  deterministic blinded-review worksheets;
- a combined structural/human grammar gate that charges decoder time,
  allocation, opcode surface, and implementation complexity;
- independent Rust video, subtitle, and audio-timing conformance gates;
- a deterministic Rust hostile-input and process-resource gate;
- a stable bounded Rust decoder API and `v64` command-line surface;
- a pointer-free, generation-checked C ABI with a real C11 conformance caller;
- a Linux-first native SDL2 video player with bounded seeking, fixed-rate
  playback, persistent viewport-anchored CRT scanlines, and headless evidence;
- Node conformance tests and golden hashes.

Video64 Drop's desktop shell, native-player subtitle/audio presentation,
WebAssembly delivery, the complete WebAssembly decoder, and VLC modules remain
staged in the ledger rather than represented as finished.

## Requirements

- Node.js 20 or newer
- FFmpeg and FFprobe
- Rust 1.85.0 for the Rust conformance gates

No npm dependencies are required.

## Quick start

```bash
npm run extract-assets
npm test
npm run sample
node prototype/js/cli.mjs inspect tests/golden/procedural.v64
node prototype/js/cli.mjs verify tests/golden/procedural.v64
npm run bench:commands
npm run bench:corpus
npm run bench:raster
npm run corpus:visual
npm run corpus:missing-classes
npm run preview:human
npm run bench:human
npm run preview:human2
npm run review:human2
npm run bench:human2
npm run palette:hyperreal
npm run bench:rd-glyph
npm run bench:human-rd-glyph
npm run bench:combined-grammar
npm run rust:hostile
npm run fuzz:corpus
cargo run --locked --package v64-cli -- inspect tests/golden/procedural.v64
cargo run --locked --package v64-cli -- verify tests/golden/procedural.v64
cargo run --locked --package v64-player --features native-ui -- \
  tests/golden/procedural.v64
```

Encode any FFmpeg-readable video with the primary 32-glyph profile:

```bash
node prototype/js/cli.mjs encode input.mp4 output.v64 \
  --fps 24 --columns 80 --palette 32 --glyphs 32 --target balanced
```

`--glyphs 32` is the default and may be omitted. Use the complete source
alphabet as an additional option when its quality gain is worth the extra rate:

```bash
node prototype/js/cli.mjs encode input.mp4 output-64.v64 \
  --fps 24 --columns 80 --palette 32 --glyphs 64 --target quality
```

The project remains named **Video 64**, and files remain `.v64`; the default
32-glyph budget is an encoder optimization profile rather than a change to the
canonical alphabet or file identity.

Decode to a conventional raster video:

```bash
node prototype/js/cli.mjs decode output.v64 decoded.mp4
```

Generate the canonical glyph atlas:

```bash
node prototype/js/cli.mjs atlas tests/golden/video64-atlas.ppm
```

Generate the complete backend-neutral command trace used by the entropy
shootout:

```bash
node prototype/js/cli.mjs trace-commands \
  tests/golden/procedural.v64 procedural-command-trace.json
```

Grammar B is experimental and does not change the v0.1 container or its golden
files. See
[`spec/V64-grammar-b-experiment.md`](spec/V64-grammar-b-experiment.md) and
[`bench/COMMAND_SHOOTOUT_1.md`](bench/COMMAND_SHOOTOUT_1.md) and
[`bench/COMMAND_SHOOTOUT_2.md`](bench/COMMAND_SHOOTOUT_2.md) and
[`bench/ENTROPY_SHOOTOUT_1.md`](bench/ENTROPY_SHOOTOUT_1.md) for its exact
syntax, validation rules, and measured iterations. The seed-corpus manifest is
[`bench/corpus/seed-manifest.json`](bench/corpus/seed-manifest.json).

The first file-backed raster-ingest result is
[`bench/RASTER_TRANCHE_0.md`](bench/RASTER_TRANCHE_0.md). Palette direction,
provenance, and the experimental Hyper Real-derived candidates are documented
in [`spec/V64-palette-research.md`](spec/V64-palette-research.md).
The first original human-content measurement, including the palette and group
duration decisions it does and does not support, is
[`bench/HUMAN_RASTER_TRANCHE_1.md`](bench/HUMAN_RASTER_TRANCHE_1.md).
The missing-class, candidate-3, subtitle-resolution, and blinded-review tranche
is [`bench/HUMAN_RASTER_TRANCHE_2.md`](bench/HUMAN_RASTER_TRANCHE_2.md).
The current scene-cut and glyph-budget profile is
[`docs/RATE_DISTORTION_PROFILE.md`](docs/RATE_DISTORTION_PROFILE.md).

See [`IMPLEMENTATION_LEDGER.md`](IMPLEMENTATION_LEDGER.md) for the historical
evidence chain and [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) for the
active frontier. See [`spec/V64-v0.1-bitstream.md`](spec/V64-v0.1-bitstream.md)
for the implemented binary layout.

Coverage-guided Rust targets, curated seed-corpus generation, deeper local
commands, and deterministic allocation ceilings are documented in
[`docs/FUZZING.md`](docs/FUZZING.md).

The stable C decoder contract, public header, status values, lifecycle, and
exact export allowlist are documented in
[`spec/V64-c-api-v1.md`](spec/V64-c-api-v1.md). The ABI intentionally uses
only fixed-width scalars: callers stream bytes into a bounded handle and read
decoded state through checked accessors, so no caller-owned pointer crosses the
Rust boundary. The corresponding Rust ownership and CLI contract is
[`docs/RUST_API.md`](docs/RUST_API.md).

Native player build requirements, controls, resource ceilings, deterministic
headless checks, and the explicit first-tranche subtitle/audio presentation
limitation are documented in
[`docs/NATIVE_PLAYER.md`](docs/NATIVE_PLAYER.md).

## Contributing and forks

Human developers, AI-assisted developers, and autonomous AI agents have equal
standing to choose Video 64 projects and workflows, create forks, open issues,
submit pull requests, and build independent implementations. Contributions are
judged by evidence, reproducibility, provenance, security, compatibility, and
maintainability rather than contributor type.

Forks, ports, alternate encoders, players, integrations, artistic variants, and
incompatible research branches are welcome without advance permission.
Authorized maintainers retain protected merges, releases, private security
handling, credentials, and legal representation; those are controlled
capabilities rather than an authorship hierarchy.

Read:

- [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution workflow and provenance;
- [`GOVERNANCE.md`](GOVERNANCE.md) for equal participation and authority bounds;
- [`AGENTS.md`](AGENTS.md) for autonomous coding-agent operating rules;
- [`SECURITY.md`](SECURITY.md) for vulnerability reporting;
- [`docs/ECOSYSTEM_OUTREACH.md`](docs/ECOSYSTEM_OUTREACH.md) for participation
  and outreach strategy.

## License and authorship

Video 64 is released under the attribution-preserving [MIT License](LICENSE),
SPDX identifier `MIT`, with `Copyright (c) 2026 Shael Riley`.

Anyone may use, copy, modify, merge, publish, distribute, sublicense, sell, fork,
port, or independently reimplement the project without requesting permission.
The copyright and permission notice must be included in copies or substantial
portions. No approval, advertising, share-alike, field-of-use, or noncommercial
condition is added.

The canonical Video 64 masks originated in ANSI Tube and were created by Shael
Riley. Contributions are accepted under MIT and must include compatible rights
for submitted code, media, data, and generated assets.
