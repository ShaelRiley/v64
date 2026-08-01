# Subtitle-mask tranche 2

## Purpose

This tranche replaces SM1's broad per-frame lower-band plane with a selective temporal side plane while retaining exact arbitrary 8×16 masks.

SM2 adds:

- connected subtitle-like region selection;
- full-plane commands;
- repeat-plane spans;
- sparse cell-removal and upsert deltas;
- strict canonical round trips and malformed-stream rejection;
- total base-V64 plus side-plane accounting;
- anonymous base-versus-SM2 motion review.

## Outcome

SM2 reduced the SM1 candidate-cell set by 63.810% and compressed side-plane rate by 91.206%, from 54.412 to 4.785 kbit/s. Total base V64 plus SM2 was 7.590% larger than base V64 alone.

Exact transcription improved from 2/8 base variants to 6/8 SM2 variants. Animated dialogue became exact at both 60 and 80 columns. The 60-column lecture variants remained unreadable because the static selector retained only 3.042 and 4.792 cells per frame on average.

The full/repeat/delta sequence semantics advance. The selector does not freeze. The next selector gate adds temporal line aggregation and bounded fallback expansion while preserving total-stream accounting.

Measured results are published in `bench/results/subtitle-mask-tranche-2/RESULTS.md`, `RESULTS.json`, and `summary.json`.
