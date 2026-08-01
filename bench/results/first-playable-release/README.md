# First playable prerelease evidence

This directory records the public evidence for
[`v0.1.0-alpha.1`](https://github.com/ShaelRiley/v64/releases/tag/v0.1.0-alpha.1),
the first playable Video 64 test release.

## Reproduce the checked identities

Download the four named release assets into one directory, then run:

```bash
sha256sum -c SHA256SUMS.txt
node prototype/js/cli.mjs verify video64-official-test-01.v64
tar -xzf video64-player-linux-x86_64.tar.gz
sha256sum video64-player-linux-x86_64/v64-player
```

Expected primary results:

- all three entries in `SHA256SUMS.txt` report `OK`;
- JavaScript verification reports `valid: true`, 1,012 frames, 22 keyframes,
  no audio runs or silence spans, and no subtitle chunks;
- the extracted `v64-player` SHA-256 is
  `ea4937a285fabeb297743d91e5ba78a035fb7f1019ebb0cb913be9273989bf88`.

For repository regression coverage at the tagged source:

```bash
npm test
cargo test --locked --workspace --all-targets
```

The pull request triggered ten permanent workflows. Every run listed in
`result.json` completed successfully before merge. The workflows remained
read-only; no temporary synchronization or self-modifying governance workflow
was retained.

## Scope and limitations

The official source is user-owned/provided. It is stored as 1920×1080 with 90°
display rotation, so the correct displayed geometry is 1080×1920. The encoder
derives an 80×71 glyph grid from that portrait geometry and contains the image
in a 640×1136 raster with deterministic black padding rather than stretching.

The release is silent base video. Native subtitle compositing and AURN/SILN
audio presentation remain future work. Genuine blinded AM1 speech listening
remains mandatory before bitrate freeze. Windows and macOS packages are not
claimed.
