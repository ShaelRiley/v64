# Video 64 v0.1.0-alpha.3 release record

This immutable record identifies the corrected Linux developer prerelease produced after the Video64 Drop file-drop crash report.

- Tested source commit: `0bffc10adaa75e0ab0615f1fc85f3ac00e991c9b`
- Fix pull request: `#18`
- Checked build workflow run: `30920797507`
- Preserved GitHub Actions artifact: `8897043703`
- Artifact digest: `sha256:37df78c5399eb171ed76face22fa7684a3498d808ee5bd3194b1455d65e1c042`
- Video64 Drop bundle SHA-256: `4225da9e1fa8f17b34130d773ceccd359d599e3ec33d374e3813134415f1fde5`

The checked build passed application tests, Rust tests and linting, release builds, audiovisual sample encoding and verification, extracted-bundle core discovery, a real H.264/AAC SDL drop smoke test, and a deliberately failed dropped-file planning test that verified the window remained alive.

Fixed behavior:

- the native executable discovers the bundled `apps/video64-drop/cli.mjs` relative to itself rather than using the GitHub build machine's compile-time path;
- dropped-file planning failures display an in-window `Could not add …` notice instead of terminating the SDL event loop and closing the application.

This remains a prerelease. System Node.js 20+, FFmpeg/FFprobe, and SDL2 are still required. AM1 8 kbps is provisional pending genuine blinded listening. Native preview/estimator presentation, Windows packaging, and macOS packaging are not claimed.