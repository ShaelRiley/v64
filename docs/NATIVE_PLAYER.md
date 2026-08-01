# Video 64 native player

`v64-player` is the Linux-first native standalone player for `.v64` files. It
uses stable decoder API version 1, the canonical 64-glyph asset, the normative
`V64-P256-1` palette, a bounded integer playback clock, and an SDL2 software
presentation surface. Decoding and rendering have no network dependency.

The immutable pre-promotion `V64-P256-CANDIDATE-1` hash remains registered for
the repository's v0.1 golden files. The player accepts exactly that legacy
proof palette and normative `V64-P256-1`; every unknown palette hash fails
closed.

## Build and run

Ubuntu 24.04 development dependencies:

```bash
sudo apt-get install libsdl2-dev
cargo build --locked --release --package v64-player --features native-ui
target/release/v64-player example.v64
```

The initial native gate is Linux-first. SDL2 also supports Windows and macOS,
but packaging and platform-specific dependency instructions remain future
work rather than claimed compatibility.

## Controls

| Control | Action |
| --- | --- |
| Space | Pause or resume |
| Left / Right | Seek backward or forward five seconds |
| Home / End | Seek to the start or declared EOF |
| Up / Down | Select 0.5×, 1×, or 2× playback |
| C | Toggle CRT scanlines immediately |
| View → CRT Scanlines | Toggle CRT scanlines immediately |
| Escape | Exit |

The CRT option is enabled on first launch and persisted as
`crt_scanlines=true` or `crt_scanlines=false`. Set `V64_PLAYER_CONFIG` to an
explicit preference path; otherwise the player uses the platform configuration
directory. Scanlines use the shared 0.18 strength, period 2, phase 1 profile.
They are applied only after deterministic rasterization, anchored to display
rows, and never modify decoded state or the unfiltered raster.

## Deterministic headless gate

```bash
cargo run --locked --release --package v64-player --features native-ui -- \
  --preferences target/native-player/preferences.conf \
  --headless-report target/native-player/report.json \
  tests/golden/procedural.v64
```

The report checks repeated forward/backward seeks, pause, fixed playback rates,
declared EOF, recovery after EOF, unfiltered raster identity, viewport-anchored
scanlines, default configuration, and extension validation. The CI gate also
runs the real SDL window loop under Xvfb for a fixed number of presentations.

## Resource and compatibility boundaries

- File reads are capped at the immutable 1 GiB core ceiling.
- The player accepts at most 1,000,000 container chunks and a 256 MiB inflated
  chunk, both beneath the core ceilings.
- Renderer grids and RGBA allocations retain the core's checked maximums.
- Playback rates are the exact rational values 1/2, 1, and 2.
- Seeking reuses one decoder state and one raster; it does not retain every
  decoded frame.
- Subtitle and audio extensions are fully validated before playback. This first
  native tranche presents base glyph video only; subtitle compositing and Opus
  audio output remain explicit follow-up work.
- Genuine blinded AM1 speech listening remains required before the final audio
  bitrate profile is frozen.
