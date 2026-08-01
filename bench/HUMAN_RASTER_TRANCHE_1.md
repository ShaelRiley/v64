# Human-content raster tranche 1

Date: 2026-07-30

This tranche advances the visual benchmark from procedural patterns to
content-bearing fictional people, faces, dialogue staging, dark scenes,
silhouettes, subtitles, 2D animation, and saturated performance lighting.
The V64 project generated the three original source plates and dedicates its
rights in them and the derived videos under CC0 1.0. Exact provenance, source
hashes, prompts, and derived-video hashes are recorded in
`bench/corpus/sources/PROVENANCE.json`.

This is not a claim about filmed-human footage and is not a blind human-rating
study. It is a reproducible first human-content engineering tranche.

## Reproduction

```bash
npm run corpus:visual
npm run preview:human
npm run bench:human
```

The committed video hashes are the stable ingest identities. Re-encoded H.264
bytes can differ across FFmpeg/libx264 builds.

Configuration:

- three source videos, crossed with two palette candidates;
- 40×11 Video 64 cells;
- 16-color palette prefix;
- 12 fps;
- 24 analyzed frames and two seconds per lane;
- temporal stability `0.48`;
- packed-byte, entropy-pass-1, and entropy-pass-2 parser candidates;
- independent-group sweep at 0.5, 1, and 2 seconds;
- raw DEFLATE level 9 selection backend.

## Entropy result

Across all six lanes:

| Metric | Packed parser | Selected parser |
|---|---:|---:|
| Command bytes | 47,871 | 50,501 |
| Raw DEFLATE bytes | 34,834 | 29,749 |

Entropy pass 2 won all six lanes. It reduced stored command groups by
**5,085 bytes / 14.598%** while increasing the pre-entropy command stream by
2,630 bytes. The canonical selected-state hash is
`f537f6b9cb1889beb96ecfcc9f0da55a52a2e9f49e75708a32be3ce500f577d8`.
Every candidate reconstructed the analyzed cell states exactly, every
compressed group round-tripped byte-for-byte, and every independent group
began with a keyframe decoded from canonical void state.

## Independent-group trade-off

| Maximum group | Groups | Selected DEFLATE bytes | Size versus 2 s | Median seek decode |
|---:|---:|---:|---:|---:|
| 0.5 s | 24 | 39,658 | +33.31% | 0.727 ms |
| 1 s | 12 | 33,625 | +13.03% | 1.139 ms |
| 2 s | 6 | 29,749 | baseline | 2.340 ms |

These timings are one local Node 24 / FFmpeg 6.1.1 run and are directional,
not conformance constants. The process high-water mark was 282,156 KiB. The
selected parser pass took 1.55–1.93 seconds per 24-frame lane. Two-second
groups are the clear size winner in this tranche; one-second groups buy roughly
half the median seek reconstruction latency at a 13% command-group penalty.

## Palette comparison

| Source class | Candidate 1 | Hyper Real candidate 2 | Hyper Real delta |
|---|---:|---:|---:|
| Lecture/dialogue | 4,241 B | 4,297 B | +56 B / +1.32% |
| Saturated performance | 5,720 B | 5,763 B | +43 B / +0.75% |
| 2D animated dialogue | 4,963 B | 4,765 B | −198 B / −3.99% |
| **Combined** | **14,924 B** | **14,825 B** | **−99 B / −0.66%** |

Hyper Real candidate 2 is marginally smaller overall, but file size is not the
deciding observation. Manual inspection of the decoded contact sheet found:

- faces, hand gesture, performer silhouette, microphone, and broad staging
  remain intelligible at 40 columns;
- Hyper Real produces the strongest magenta/cyan/amber identity in the
  performance lane;
- the current 16-color Hyper Real prefix weakens some blue/teal identity and
  midtone separation in the lecture and animation lanes;
- neither palette makes the subtitles readable at 40 columns.

Therefore Hyper Real remains the preferred chromatic identity, but candidate 2
must not replace the runtime palette unchanged. Candidate 3 should preserve the
canonical saturated anchors while improving the 16-color prefix's midtone,
skin, blue/teal, and subtitle-edge utility.

## Temporal behavior

| Lane | Changed cells | One-frame reversion flicker |
|---|---:|---:|
| Lecture, candidate 1 | 17.352% | 2.376% |
| Lecture, Hyper Real 2 | 17.638% | 2.397% |
| Performance, candidate 1 | 27.125% | 1.736% |
| Performance, Hyper Real 2 | 27.075% | 2.014% |
| Animation, candidate 1 | 22.075% | 3.626% |
| Animation, Hyper Real 2 | 21.670% | 3.512% |

The flicker proxy counts cells that change and then return exactly to their
two-frames-prior token. It is objective and reproducible but not a substitute
for blinded visual scoring.

## Coverage and next decision

This tranche covers eight of the eleven required visual classes:
dialogue, dark cinematography, rapid motion, 2D animation, music video,
subtitles, static lecture, and highly saturated material. It does not yet cover
3D animation, black-and-white film, or screen capture.

Do not freeze the palette, grammar, or group duration yet. Build candidate 3,
add the three missing content classes, test subtitles at 60 and 80 columns, and
run a blinded recognizability comparison before the normative visual profile is
selected.
