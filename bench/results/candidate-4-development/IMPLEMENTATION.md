# Candidate 4, motion review, and subtitle-mask development tranche

Date: 2026-07-30

## Bottom line

This tranche implements the three development gates that followed human raster tranche 2:

1. deterministic Hyper Real Candidate 4;
2. anonymous motion-review artifacts using the established blind codes;
3. a bounded sparse subtitle-mask grammar prototype that preserves arbitrary 8x16 strokes.

No visual asset, grammar extension, or group duration is normative yet.

## Candidate 4

Candidate 4 preserves ANSI Tube's exact twelve Hyper Real anchors and the Candidate-3 dark navy, dark teal, and neutral midtone utilities. It replaces Candidate 3's redundant extra warm-skin utility with a light-neutral rung `[224, 224, 224]`.

- asset ID: `V64-P256-HYPERREAL-CANDIDATE-4`
- 16-color prefix SHA-256: `1e8997b6c6abb748df607bfe3156898a4fd6df547554b31cb150ce31c410bfd6`
- complete palette SHA-256: `f683d64d46f95d5cd49638302eb18aeee7ac1684b2ad22b61ff7b4984c3ffd37`
- executable default: unchanged (`V64-P256-CANDIDATE-1`)

The generator, tracked metadata, registry, and focused reproducibility test agree on the exact palette.

## Anonymous motion review

`preview:human2` now emits complete decoded two-second MP4s for every tranche-2 lane. `review:human2` copies them under the same eight-character blind codes used by the still review and emits:

- `motion/<CODE>.mp4` for fourteen anonymous clips;
- `temporal-worksheet.csv`;
- `motion-review.md`;
- `motion-public-manifest.json`.

The code-to-palette mapping remains solely in the existing concealed `key.json`. Inspection of the final blind artifact found fourteen code-only review MP4s, fourteen source-named preview MP4s, one temporal worksheet, and zero copies of `key.json`.

## Subtitle-mask grammar prototype

`prototype/js/subtitle-mask.mjs` defines an experimental sparse mask plane:

- fixed `SM1\0` header with declared cell count, record count, and palette depth;
- strictly row-major delta-coded cell positions;
- one arbitrary 8x16 bitmap mask plus foreground/background palette indices per record;
- lower-band high-contrast extraction for subtitle candidates;
- exact mask rasterization;
- bounded varints, palette checks, no-progress rejection, truncation rejection, and trailing-byte rejection.

The focused conformance fixture preserves an exact synthetic 8x16 letterform through extract, encode, decode, and rasterize, and rejects damaged streams. The syntax is not yet integrated into the V64 container or bitrate optimizer.

## Validation

Clean GitHub Actions run `30574053284` at head `1b9280dc9bd77fdf1b4c250b741d13b642560f57` completed successfully:

- all Node conformance tests passed;
- Candidate-4 generation and registry validation passed;
- all fourteen source-named motion previews rendered;
- all fourteen anonymous review clips and worksheets were built;
- the full fourteen-lane entropy benchmark completed;
- blind and concealed-key artifacts uploaded separately.

Artifacts:

- blind artifact digest: `sha256:2a15a1a394374cbcfea40021b1f43655ca5006d4b31daca7d36e5e4ea7111362`
- concealed-key artifact digest: `sha256:7381709f579093b95263f217aeddc69dd20a7dd8f14cce0955eae7b5531eb190`

## Next gate

1. Score the anonymous motion clips before consulting the concealed key.
2. Add matched Candidate-1/Candidate-4 lanes for monochrome, depth, screen capture, and subtitle content.
3. Integrate the subtitle-mask plane into decoded preview and entropy accounting, then measure its byte cost against exact subtitle transcription at 60 and 80 columns.
4. Freeze no palette or subtitle syntax until those matched results are published.
