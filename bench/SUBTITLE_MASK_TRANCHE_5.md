# Subtitle-mask tranche 5

## Purpose

This tranche is the full subtitle-readability and rate gate for span-aware SM4/SM5 selection.

It crosses:

- lecture and animated dialogue;
- 60- and 80-column grids;
- the legacy Candidate-1 palette and normative `V64-P256-1`;
- base raster output and span-stabilized subtitle restoration.

The eight source lanes produce sixteen anonymous motion clips. The blind worksheet is scored before the concealed variant key is opened.

## Selector and sequence model

1. Extract bounded lower-band arbitrary 8×16 masks.
2. Discover subtitle regions through connected components and horizontal temporal projection.
3. Detect deterministic adjacent caption spans from selected-cell similarity.
4. Merge sparse or undersized transition spans toward the more similar neighbor.
5. Build one persistent consensus plane per stable span.
6. Encode the result using the existing SM2 full-plane, repeat-span, and sparse removal/upsert-delta grammar.

No new decoder opcode is introduced.

## Exit criteria

The gate passes only when:

- all eight stabilized variants are transcribed exactly;
- the base-plus-side-plane stream is no more than 10% larger than selected base V64;
- blind edge clarity and temporal stability improve materially;
- scene preservation remains acceptable;
- source frames are never mutated;
- sequence encode/decode is canonical and bounded.

## Result

The gate passed:

- exact transcription: **8/8**;
- total-stream overhead: **7.082%**;
- mean edge clarity: **4.875/5**;
- mean temporal stability: **4.875/5**;
- mean scene preservation: **4/5**.

See `bench/results/subtitle-mask-tranche-5/RESULTS.md` and the structured summary and score files under `bench/results/subtitle-mask-tranche-5/` and `bench/reviews/subtitle-mask-tranche-5/`.
