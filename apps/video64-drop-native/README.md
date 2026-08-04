# Video64 Drop native shell

This crate is the Linux-first SDL2 desktop host for Video64 Drop. It deliberately
uses the tested JavaScript application core in `../video64-drop` for queue
planning, source analysis, video and AM1 audio encoding, progress events,
audiovisual remuxing, and final verification. The native shell does not
duplicate the codec.

## Current interaction

- Drop one or more source videos into the window, or pass them as command-line
  arguments.
- Press `Tab` to move through cadence, columns, palette, glyph-budget, and
  profile controls.
- Press Left or Right to change the focused discrete control.
- Press Up or Down to select a queued file.
- Press Enter or `E` to encode every queued file sequentially.
- Press Delete to remove a queued or failed file, `R` to retry a failed file,
  and `O` to open the completed output folder.
- Completed outputs are independently verified by the application core.

Source audio is detected and encoded as provisional AM1 mono 48 kHz Opus.
Qualifying long silence is represented by exact `SILN` spans and audible regions
by bounded `AURN` runs. Sources without audio retain an explicit skipped audio
stage.

The current `AM1-PROVISIONAL-8K` setting is not frozen. Genuine blinded speech
listening remains required before the 8 kbps candidate can become normative.

The application core handles long recordings with a bounded two-pass disk spool
rather than a whole-file PCM memory buffer. It scans source PCM in fixed reads
and loads at most one 60-second audible run at a time. The default source-PCM
buffer bound is 5,760,000 bytes, while temporary disk use grows with recording
duration. A permanent gate processes a 47-minute, 270,720,000-byte spool beyond
the former 256 MiB ceiling.

The adjacent application core and CLI also provide deterministic sampled size
estimation and source-versus-decoded-V64 PPM previews. Those functions reuse the
real proof encoder, decoder, palette, and renderer. The current SDL2 window does
not yet invoke or display them, so the native capability report continues to
mark both features false until interactive integration is checked.

## Build and run

```bash
cargo build --release -p video64-drop-native --features native-ui
./target/release/video64-drop input.mp4
```

The development build expects Node.js and the adjacent application-core files.
`VIDEO64_DROP_NODE` can override the Node executable, and `--core-cli PATH` can
override the core CLI location.

## Evidence modes

```bash
./target/release/video64-drop \
  --headless-report shell-report.json input.mp4

./target/release/video64-drop \
  --headless-encode input.mp4 output.v64 \
  --headless-report encode-report.json
```

The permanent native-shell workflow opens the real SDL2 window under Xvfb,
requires a deterministic shell report, encodes a real H.264/AAC source, and
independently verifies that the resulting `.v64` carries AM1 audio through the
bounded disk-spooled application core.

## Transitional boundary

This tranche does not claim a frozen AM1 bitrate, one-pass live-capture audio,
interactive native preview or estimate presentation, Particle Lighting controls,
cancellation of an active encode, a bundled Node runtime, desktop file
selection, or an installable Linux package.
