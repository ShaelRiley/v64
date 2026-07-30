# Subtitle-mask tranche 4

## Purpose

Tranche 4 tests whether SM3's exactly readable but expensive projected subtitle planes can be stabilized into one persistent plane per static subtitle span without changing the existing SM2 sequence grammar.

SM4 adds:

- per-cell recurrence thresholds;
- modal foreground/background palette pairs;
- bitwise consensus 8×16 masks;
- one canonical plane held across a stable subtitle span;
- repeat-span transmission through the existing SM2 opcode;
- focused base-versus-SM3-versus-SM4 blind motion review.

## Outcome

SM4 preserved exact `WE KEEP THE SIGNAL.` transcription on both 60-column lecture lanes, with 5/5 edge clarity and 5/5 temporal stability. Compressed side-plane bytes fell from 12,284 for SM3 to 1,806 for SM4. Total-stream overhead fell from 62.327% to 9.163%, clearing the focused 10% ceiling.

SM4 persistent-plane stabilization advances. No new decoder opcode is needed. The next gate is a full eight-lane regression across lecture and animated dialogue at 60 and 80 columns before normative container integration.

Measured results are published in `bench/results/subtitle-mask-tranche-4/RESULTS.md` and `summary.json`.
