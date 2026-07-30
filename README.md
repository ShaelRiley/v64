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

- exact extracted 64-glyph `8×16` asset and immutable SHA-256 identity;
- all eleven legal cadences and all fourteen legal palette depths;
- deterministic source-pixel analysis, glyph matching, palette quantization,
  cell rendering, and temporal hysteresis;
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
- Node conformance tests and golden hashes.

Audio Opus, Rust, Video64 Drop's desktop shell, the native player, and VLC
modules are staged in the ledger rather than represented as finished.

## Requirements

- Node.js 20 or newer
- FFmpeg and FFprobe

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
```

Encode any FFmpeg-readable video:

```bash
node prototype/js/cli.mjs encode input.mp4 output.v64 \
  --fps 24 --columns 80 --palette 32 --profile balanced
```

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

See [`IMPLEMENTATION_LEDGER.md`](IMPLEMENTATION_LEDGER.md) for verified status,
blockers, and the next concrete step. See
[`spec/V64-v0.1-bitstream.md`](spec/V64-v0.1-bitstream.md) for the implemented
binary layout.

## Attribution and licensing status

The canonical Video 64 masks originated in ANSI Tube and were created by Shael
Riley. The inspected ANSI Tube repository has no root license. This repository
therefore records provenance and does not choose a redistribution license on
Shael's behalf. A project license remains a governance decision before public
binary distribution.
