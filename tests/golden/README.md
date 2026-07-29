# Golden fixtures

- `procedural-source.mp4`: legally generated two-second FFmpeg source.
- `procedural.v64`: deterministic v0.1 proof encode.
- `procedural-decoded.mp4`: raster decode of the proof encode.
- `procedural-decoded-frame24.png`: visually inspected middle frame.
- `video64-atlas.ppm` and `.png`: all 64 glyph masks, indices 0–63 in row-major
  order, white foreground on black.
- `SHA256SUMS`: immutable hashes for this checkpoint.

Regenerate with:

```bash
npm run sample
ffmpeg -y -v error -i tests/golden/procedural-decoded.mp4 \
  -vf 'select=eq(n\,24)' -frames:v 1 \
  tests/golden/procedural-decoded-frame24.png
ffmpeg -y -v error -i tests/golden/video64-atlas.ppm \
  tests/golden/video64-atlas.png
sha256sum tests/golden/procedural-source.mp4 \
  tests/golden/procedural.v64 \
  tests/golden/procedural-decoded.mp4 \
  tests/golden/procedural-decoded-frame24.png \
  tests/golden/video64-atlas.ppm \
  tests/golden/video64-atlas.png
```
