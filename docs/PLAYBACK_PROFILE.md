# V64 playback profile

## CRT scanlines

The native `apps/v64-player` and VLC glyph-video decoder output must expose a CRT scanline presentation option with the following invariant behavior:

- **Enabled by default** on first launch and first plugin use.
- Immediately toggleable during playback without restarting or re-decoding the stream.
- Persisted independently by the native player and VLC plugin after the user changes it.
- Implemented strictly as a presentation-layer effect after deterministic V64 rasterization; it must not alter decoded frame state, verification hashes, screenshots or exports unless an export explicitly requests display effects.
- Applied in display-pixel space after aspect-ratio scaling, with phase anchored to the output viewport so seeking and repeated frames cannot make the scanline pattern shimmer.
- Intensity must remain bounded and legibility-preserving. The initial profile uses alternating display rows with a darkening multiplier and no geometric distortion, bloom, chromatic aberration, or phosphor persistence.
- Reduced-motion settings do not disable static scanlines, but any future animated CRT effects must honor reduced-motion preferences.

### Default configuration

```text
crt_scanlines = true
crt_scanline_strength = 0.18
crt_scanline_period = 2 display pixels
crt_scanline_phase = 1
```

The native player exposes this under **View → CRT Scanlines** and a direct keyboard toggle. The VLC plugin exposes the same default through the `v64-crt-scanlines` module option and a playback-menu toggle where supported by the pinned VLC API.

## Shared implementation contract

`prototype/js/playback-effects.mjs` defines the renderer-neutral reference behavior used by conformance tests:

- `DEFAULT_PLAYBACK_EFFECTS.crtScanlines` is `true`;
- native and VLC option descriptors both default to enabled;
- the effect clones the decoded RGBA raster before applying presentation changes;
- disabling the option returns a byte-identical unfiltered raster in a distinct output buffer;
- scanline strength, period, and phase are bounded and validated.

Native and VLC implementations may use GPU shaders or platform-native pixel pipelines, but their default configuration and visible row-darkening behavior must agree with this reference profile.

## Conformance boundary

CRT scanlines are deliberately non-normative presentation metadata. A conforming decoder must produce identical decoded RGBA frames whether the effect is enabled or disabled. Automated conformance compares the unfiltered raster; UI tests compare default-on configuration, toggle behavior, persistence, and phase stability.
