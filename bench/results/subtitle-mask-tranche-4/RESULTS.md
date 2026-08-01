# Subtitle-mask tranche 4: persistent canonical SM4 plane

Date: 2026-07-30

## Bottom line

**SM4 clears the focused 60-column lecture readability and rate gate.** It preserves SM3's exact 2/2 transcription, 5/5 edge clarity, and 5/5 temporal stability while reducing compressed side-plane bytes from 12,284 to 1,806. Total base-V64 plus side-plane overhead falls from 62.327% to **9.163%**, below the 10% target.

SM4 derives one canonical persistent subtitle plane from SM3's temporally discovered line, chooses modal palette pairs and consensus 8×16 masks, and repeats the immutable plane across the stable subtitle span. The already-checked SM2 full-plane and repeat-span syntax carries the result; no new decoder opcode is required.

## Checked implementation

Clean GitHub Actions run `30591665741` at code head `b96f45d3abed42d9da25bf55c7e29a5e12a10305` passed conformance and the focused SM3-versus-SM4 gate. Candidate 6 was correctly skipped by path-specific CI.

The checked path includes:

- horizontal temporal projection for subtitle-line discovery;
- bounded SM3 spatial fallback;
- per-cell recurrence thresholds;
- modal foreground/background palette selection;
- bitwise consensus masks;
- one canonical plane per stable span;
- canonical full-plane plus repeat-span round trips;
- non-mutation and malformed-option tests.

## Rate results

Across two 60-column lecture lanes and 48 frames:

| Metric | SM3 | SM4 | Change |
|---|---:|---:|---:|
| Selected cell-frames | 3,511 | 4,968 | +41.499% |
| Unique persistent plane cells | frame-local | 207 | — |
| Raw sequence bytes | 32,454 | 3,975 | -87.752% |
| Raw-DEFLATE side-plane bytes | 12,284 | **1,806** | **-85.298%** |
| Side-plane rate | 24.568 kbit/s | **3.612 kbit/s** | -85.298% |
| Base V64 selected bytes | 19,709 | 19,709 | unchanged |
| Total V64 plus side plane | 31,993 | **21,515** | -32.751% |
| Focused-stream overhead | 62.327% | **9.163%** | -53.164 pp |

The baseline palette produced a 104-cell persistent plane and 897 compressed bytes. Candidate 4 produced a 103-cell plane and 909 compressed bytes.

SM4 intentionally retains more cell-frames than SM3 because it holds one complete, stable subtitle plane across all 24 frames. Repeat-span coding makes this cheaper than carrying smaller but fluctuating frame-local planes.

## Pre-key blind review

All six base, SM3, and SM4 motion clips were scored by anonymous code before the concealed key was opened.

| Variant | Exact transcription | Mean edge clarity | Mean temporal stability | Mean scene preservation |
|---|---:|---:|---:|---:|
| Base | 0/2 | 1.0/5 | 2.0/5 | 4.0/5 |
| SM3 | **2/2** | **5.0/5** | **5.0/5** | 4.0/5 |
| **SM4** | **2/2** | **5.0/5** | **5.0/5** | 4.0/5 |

Both SM4 clips exactly rendered `WE KEEP THE SIGNAL.` throughout the reviewed motion interval.

## Decision

1. **Advance SM4 canonical persistent-plane stabilization.**
2. Preserve SM2's existing full-plane, repeat-span, and removal/upsert-delta sequence grammar; SM4 requires no additional opcode.
3. Retain SM3 horizontal projection as line discovery, not as the transmitted per-frame plane.
4. The next subtitle gate is a complete eight-lane regression across lecture and animated dialogue at 60 and 80 columns.
5. Require exact transcription on all eight lanes and total-stream overhead at or below 10% before integrating the side-plane into the normative V64 container registry.
6. Dynamic subtitle changes must open a new persistent span or fall back to frame-local SM2 deltas; static-span detection remains experimental until the full regression passes.

## Reproducibility

- Base V64 canonical selection SHA-256: `255fde8d18e2c5a745716c29e63f354384a9753cf6575f3b1d06595c24e747c4`.
- Baseline SM4 sequence SHA-256: `65f1fe983fe4bae73977de712e0c42e09c798058687baa94b33eb3052cd57576`.
- Candidate-4 SM4 sequence SHA-256: `65c0dc93f58757f7021655a698e45a05803c0a2e6c047ca2ab06dcb0c2dbebf6`.
- Blind artifact digest: `sha256:a480fa985b35bc37107db51118c868ebc6939f417f5e6667f9b0f0e95e744aae`.
- Concealed-key artifact digest: `sha256:cf804d1652cb205a29d34ae0340585a330c9de9772143a208b5a6e07720cba66`.
