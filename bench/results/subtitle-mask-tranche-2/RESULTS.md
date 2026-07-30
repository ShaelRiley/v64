# Subtitle-mask tranche 2: selective temporal SM2

Date: 2026-07-30

## Bottom line

**SM2 is a successful rate-efficiency advance and should remain the subtitle-side-plane foundation, but its current region selector is incomplete.** It reduces the SM1 candidate-cell set by 63.810%, lowers compressed side-plane rate from 54.412 to 4.785 kbit/s, and raises exact transcription from 2/8 base variants to 6/8 SM2 variants. Both 60-column lecture variants remain unreadable because the selector admits only 3.042 and 4.792 cells per frame on average.

The SM2 full/repeat/delta sequence syntax advances. The static per-frame selector does not freeze. The next iteration must aggregate subtitle-line evidence temporally and provide a bounded fallback when a plausible line is detected but too few cells survive.

## Checked implementation

Clean GitHub Actions run `30587498438` at code head `8b0f80dda9da650e40b75edfbef16c91cea28df7` passed:

- strict SM2 full-plane, repeat-span, and removal/upsert-delta round trips;
- malformed-stream rejection;
- selective connected-region extraction;
- eight matched subtitle lanes and 192 frames;
- total base-V64 plus side-plane byte accounting;
- sixteen anonymous base-versus-SM2 motion clips;
- segregated blind and concealed-key artifacts.

## Rate results

| Metric | SM1 | SM2 | Change |
|---|---:|---:|---:|
| Candidate/selected cells | 28,632 | 10,362 | -63.810% |
| Compressed side-plane bytes | 108,823 | 9,569 | -91.207% |
| Side-plane rate | 54.412 kbit/s | 4.785 kbit/s | -91.206% |

SM2's base V64 subtitle lanes used **126,080 selected raw-DEFLATE bytes**. Adding SM2 produced **135,649 total bytes**, an overhead of **7.590%** over the base V64 stream.

SM2 raw sequence size was **34,117 bytes** before lane-local raw DEFLATE.

## Pre-key blind review

All sixteen motion variants were scored by anonymous code before the concealed key was opened.

| Metric | Base | SM2 |
|---|---:|---:|
| Exact transcriptions | 2/8 | **6/8** |
| Mean edge clarity | 2.000/5 | **4.125/5** |
| Mean temporal stability | 2.750/5 | **4.375/5** |
| Mean scene preservation | 4.000/5 | 4.000/5 |

### Exact transcription by content and grid

| Content/grid | Base | SM2 |
|---|---:|---:|
| Lecture, 60 columns | 0/2 | 0/2 |
| Animated dialogue, 60 columns | 0/2 | **2/2** |
| Lecture, 80 columns | 2/2 | 2/2 |
| Animated dialogue, 80 columns | 0/2 | **2/2** |

SM2 exactly restored `NOTHING IMPORTANT SHOULD DISAPPEAR.` at both 60 and 80 columns. The 80-column lecture subtitle `WE KEEP THE SIGNAL.` was already readable on the base path, though SM2 improved the clearest variant's edges and stability. The 60-column lecture lane remained fragmented for both palettes.

## Selector diagnosis

The 60-column lecture variants began with 2,428 SM1 candidate cells each, but SM2 retained only:

- Candidate 1: **73 cells total, 3.042 per frame**, 406 compressed bytes;
- Candidate 4: **115 cells total, 4.792 per frame**, 661 compressed bytes.

By contrast, the exact 60-column animated variants retained roughly **85.8 cells per frame**. The failure is therefore under-selection rather than insufficient sequence syntax.

## Decision

1. **Advance SM2 full-plane, repeat-plane-span, and cell-removal/upsert-delta semantics.**
2. **Reject the current static connected-region selector as complete.**
3. Keep SM2 outside the normative V64 container until exact 60-column lecture transcription is recovered without materially exceeding a 10% total-stream overhead target.
4. Build the next selector around temporal line aggregation:
   - accumulate plausible lower-band cells across adjacent frames;
   - score horizontal continuity, persistence, and baseline alignment;
   - apply a bounded fallback expansion around a persistent line when the selected set is implausibly sparse;
   - retain repeat spans and cell deltas unchanged for an isolated selector comparison.
5. Continue measuring total V64 plus side-plane bytes, not side-plane bytes in isolation.

## Reproducibility

- Base V64 canonical selection SHA-256: `5bbc8b3c58f6eee2ff665d9df5dc5e7752cba54cc3b44e2f04d8d844ed776bd0`.
- Blind artifact digest: `sha256:e65a62da82c8ab33edb7a3b17b3c2257016b67b46ef5fd9778e88bb8b22736a2`.
- Concealed-key artifact digest: `sha256:6eda1a997189f9dc7972816f73ed93a9f1d591b993f7bb487f88d62181168bd7`.
