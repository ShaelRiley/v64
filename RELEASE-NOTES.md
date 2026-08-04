## Video 64 v0.1.0-alpha.3

This prerelease replaces the broken alpha.2 Video64 Drop bundle.

### Fixed

- The native executable now discovers the bundled application core relative to itself instead of using the GitHub build machine's compile-time path.
- Dropping an MP4 that cannot be planned now displays an in-window error instead of terminating the SDL event loop and closing the application.
- Permanent CI now launches the exact extracted release layout without a wrapper, drops a real H.264/AAC MP4, and deliberately forces a planning error to prove the window remains alive.

Tested source commit: `0bffc10adaa75e0ab0615f1fc85f3ac00e991c9b`.

This remains a Linux x86_64 developer prerelease requiring system Node.js 20+, FFmpeg/FFprobe, and SDL2. AM1 8 kbps remains provisional pending genuine blinded listening. Native preview/estimator presentation, Windows packaging, and macOS packaging are not claimed.
