# V64

V64 is a deliberately low-fidelity audiovisual container and glyph-video codec
derived from Shael Riley's canonical **Video 64 Homebrew** alphabet in
[ANSI Tube](https://github.com/ShaelRiley/ansi-tube).

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
- Node conformance tests and golden hashes.

Audio Opus, Rust, ANSI Drop's desktop shell, the native player, and VLC modules
are staged in the ledger rather than represented as finished.

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
