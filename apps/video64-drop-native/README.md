# Video64 Drop native shell

This crate is the Linux-first SDL2 desktop host for Video64 Drop. It deliberately
uses the tested JavaScript application core in `../video64-drop` for queue
planning, source analysis, encoding, progress events, and final verification.
The native shell does not duplicate the codec.

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

Source audio is detected and visibly disclosed. AM1 source-audio encoding is not
yet connected, so current shell output remains silent and the audio stage is
explicitly skipped.

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

The permanent native-shell workflow also opens the real SDL2 window under Xvfb
and requires a deterministic shell report plus a real FFmpeg-to-V64 encode.

## Transitional boundary

This tranche does not yet claim AM1 source-audio encoding, decoded source/V64
preview, sampled size estimation, Particle Lighting controls, cancellation of an
active encode, a bundled Node runtime, or an installable Linux package.
