# Video 64 native player

`v64-player` is the Linux-first native standalone player for `.v64` files. It
uses stable decoder API version 1, native player profile version 2, the
canonical 64-glyph asset, the normative `V64-P256-1` palette, a bounded integer
playback clock, SDL2 software presentation, and libopus decoding. Decoding,
rendering, subtitle compositing, and audio presentation have no network
dependency.

The immutable pre-promotion `V64-P256-CANDIDATE-1` hash remains registered for
the repository's v0.1 golden files. The player accepts exactly that legacy
proof palette and normative `V64-P256-1`; every unknown palette hash fails
closed.

## Build and run

Ubuntu 24.04 development dependencies:

```bash
sudo apt-get install libopus-dev libsdl2-dev
cargo build --locked --release --package v64-player --features native-ui
target/release/v64-player example.v64
```

The native gate is Linux-first. SDL2 and libopus support Windows and macOS, but
packaging and platform-specific dependency instructions remain future work
rather than claimed compatibility.

## Controls

| Control | Action |
| --- | --- |
| Space | Pause or resume video and audio |
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
They are applied only after deterministic rasterization and subtitle
compositing, anchored to display rows, and never modify decoded state or the
unfiltered raster.

## Subtitle presentation

Validated `SUBT` chunks are decoded with the normative SM2 sparse-cell syntax.
At each active subtitle frame, every declared cell replaces that cell's final
8×16 raster area using the entry's exact one-bit mask and foreground/background
palette indices. Cells absent from the sparse frame remain untouched. Subtitle
transitions refresh the presentation raster even when the underlying video
record is a repeat span.

A seek reconstructs the base video state through the bounded core decoder and
then selects the subtitle frame directly from the validated timeline. The
player does not cache a raster for every subtitle or video frame.

## Audio presentation

Validated `AURN` packets are decoded as mono 48 kHz Opus. The player checks each
packet's decoded sample count, applies the declared pre-skip and end trim, and
inserts exact zero-valued PCM for every `SILN` span. The complete timeline must
cover the declared container duration on an exact 48 kHz sample boundary.

Decoded PCM is capped at 256 MiB. The SDL queue is bounded and refilled from the
single validated timeline. Pause, resume, seeking, EOF, and recovery
resynchronize the queue to the integer Video 64 clock. The fixed 0.5× and 2×
modes currently use deterministic sample repetition or decimation,
respectively; therefore pitch follows playback rate rather than invoking an
opaque time-stretching algorithm.

For deterministic inspection, the player can emit raw little-endian mono
PCM16 without opening an audio device:

```bash
v64-player \
  --dump-audio-pcm target/native-player/audio.pcm \
  --headless-report target/native-player/report.json \
  example.v64
```

## Deterministic profile-v2 gate

```bash
cargo run --locked --release --package v64-player --features native-ui -- \
  --preferences target/native-player/preferences.conf \
  --headless-report target/native-player/report.json \
  tests/golden/procedural.v64
```

Player-profile-v2 reports check repeated forward/backward seeks, pause, fixed
playback rates, declared EOF, recovery after EOF, unfiltered raster identity,
viewport-anchored scanlines, default configuration, subtitle presentation
hashes, extension validation, decoded PCM dimensions, and decoded PCM identity.

The CI gate builds the canonical procedural, SUBT, and AM1 fixtures twice;
requires byte-identical reports; compares native AM1 PCM byte-for-byte with the
reference decoder output; and runs the real SDL video/audio loop under Xvfb
with a dummy audio device.

## Feature-length synchronization gate

`v64-av-sync-gate` provides accelerated deterministic evidence for long-file
clock and timeline behavior without sleeping for the media's full wall-clock
duration:

```bash
node tools/build-feature-length-av-fixture.mjs target/av-sync/fixture
cargo run --locked --release --package v64-player \
  --bin v64-av-sync-gate --features native-audio -- \
  target/av-sync/fixture/feature-length-av.v64 \
  target/av-sync/report.json
```

The canonical feature-length fixture is exactly 30 minutes and contains:

- 900 independently seekable two-second groups;
- 43,200 nominal video frames represented by 900 keyframes and 900 repeat
  spans;
- 1,800 `AURN` runs and 1,800 exact `SILN` spans;
- 48,600 Opus packets;
- 86,400,000 mono samples at 48 kHz;
- 172,800,000 decoded PCM bytes, or 64.37% of the 256 MiB player ceiling.

The gate advances the real player clock through 4,941 irregular nanosecond
increments and compares the result with a single 30-minute increment. It checks
intermediate video-record containment, PCM sample positions, repeated distant
seeks, pause, 0.5× and 2× transitions, declared EOF, and recovery after EOF.

Permanent workflow `30709579841` passed at checked head
`554456a037e8393b5793326cddc418f6a7ea8b55` with zero accumulated tick drift
and zero sample-index drift. Peak resident memory was 176,464 KiB. Duplicate
reports were byte-identical.

Checked identities:

- fixture SHA-256:
  `6cb462f16e2ebf9e0bf576210f1d8c6177cc9b69ba4f1045beef0252034d1f58`;
- report SHA-256:
  `4b667cfc198c5a9e9b10846082b4e68be1d2cb07db80e1996e7ca1520b25f2ce`;
- gate binary SHA-256:
  `91565e09695271a1af593994ffbc26dfabf8a70e2c082561b28bcd3fdad42443`;
- evidence artifact: `8821428834`;
- artifact digest:
  `3e422742a81fdb004fa85b3f89b8663a42b2a5353a037be1e37b0f096e49bb56`.

This evidence proves player-clock arithmetic, decoded video-record selection,
and decoded PCM timeline alignment. It deliberately does not claim measurement
of operating-system mixer latency, audio-device oscillator error, or physical
hardware scheduling drift. Those remain platform qualification work.

## Resource and compatibility boundaries

- File reads are capped at the immutable 1 GiB core ceiling.
- The player accepts at most 1,000,000 container chunks and a 256 MiB inflated
  chunk, both beneath the core ceilings.
- Decoded audio is capped at 256 MiB of mono PCM16.
- Renderer grids and RGBA allocations retain the core's checked maximums.
- Playback rates are the exact rational values 1/2, 1, and 2.
- Seeking reuses one decoder state, one raster, and one validated audio
  timeline; it does not retain every decoded frame or subtitle raster.
- Subtitle and audio extensions are fully validated before presentation.
- Genuine blinded AM1 speech listening remains required before the final audio
  bitrate profile is frozen.
- Operating-system and physical-device A/V drift remain platform qualification
  work rather than a claim of the accelerated synchronization gate.
