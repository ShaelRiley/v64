# V64 playback profile

## CRT scanlines

The native `apps/v64-player` and VLC glyph-video decoder output must expose a CRT scanline presentation option with the following invariant behavior:

- **Enabled by default** on first launch and first plugin use.
- Immediately toggleable during playback without restarting or re-decoding the stream.
- Persisted independently by the native player and VLC plugin after the user changes it.
- Implemented strictly as a presentation-layer effect after deterministic V64 rasterization; it must not alter decoded frame state, verification hashes, screenshots or exports unless an export explicitly requests display effects.
- Applied in display-pixel space after aspect-ratio scaling, with phase anchored to the output viewport so seeking and repeated frames cannot make the scanline pattern shimmer.
- Intensity must remain bounded and legibility-preserving. The initial profile should use alternating display rows with a darkening multiplier and no geometric distortion, bloom, chromatic aberration, or phosphor persistence.
- Reduced-motion settings do not disable static scanlines, but any future animated CRT effects must honor reduced-motion preferences.

### Default configuration

```text
crt_scanlines = true
crt_scanline_strength = 0.18
crt_scanline_period = 2 display pixels
```

The native player should expose this under **View → CRT Scanlines** and a direct keyboard toggle. The VLC plugin should expose the same default through a module option and a playback-menu toggle where supported by the pinned VLC API.

## Conformance boundary

CRT scanlines are deliberately non-normative presentation metadata. A conforming decoder must produce identical decoded RGBA frames whether the effect is enabled or disabled. Automated conformance compares the unfiltered raster; UI tests compare default-on configuration, toggle behavior, persistence, and phase stability.
