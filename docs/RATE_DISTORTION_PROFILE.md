# V64 scene-cut and rate-distortion profile

Status: checked JavaScript proof-profile behavior

## Glyph-count policy

The project name remains **Video 64**, and encoded files continue to use the
`.v64` extension. The canonical source alphabet still contains all 64 glyphs.

The primary encoder budget is **32 glyphs**. This is the default for ordinary
encoding and the main optimization target during continued development. The
full 64-glyph alphabet remains an explicit additional option for material that
benefits from the extra shapes. A 16-glyph budget remains available only in
comparative research and compact-limit studies; it is not a primary product
encoding choice.

Command-line behavior:

- default: `--glyphs 32`;
- optional full-alphabet path: `--glyphs 64`;
- accepted primary budgets: 32 and 64.

## Independent groups

The maximum independent-group duration is **two seconds**, derived from the
selected cadence. Examples:

- 48 frames at 24 fps;
- 24 frames at 12 fps;
- 12 frames at 6 fps.

A scene cut may begin a new group earlier but may never extend a group past that
cadence-derived maximum. Every group begins with a self-contained keyframe.

The deterministic cut score combines:

- 55% mean absolute weighted RGB difference;
- 30% fraction of sampled pixels whose luma changes by at least 32;
- 15% absolute mean-luma shift.

Scores are clamped to `[0,1]`. Identical frames score zero and a complete
black-to-white cut scores one.

## Target modes

| Mode | Glyph candidates | Temporal stability | Distortion weight | Scene-cut threshold |
|---|---|---:|---:|---:|
| `compact` | 32 | 0.82 | 0.75 | 0.58 |
| `balanced` | 32 | 0.48 | 4 | 0.44 |
| `quality` | 32, 64 | 0.18 | 16 | 0.34 |

`balanced` is the default target mode. The ordinary CLI fixes the selected
primary budget to either 32 or 64 through `--glyphs`; the adaptive 32/64 quality
comparison remains available to benchmark and future product-estimation paths.

For each frame, the analyzer first derives the canonical 64-glyph cell state.
Each permitted glyph budget is then produced by deterministic nearest-mask
remapping. Candidate rate is the actual bounded command payload length for the
current keyframe or delta context. Distortion is normalized RGB mean-squared
error against the source proxy after canonical V64 rasterization.

The selected objective is:

`command bytes / cell count + normalized distortion × mode distortion weight`

Ties resolve by lower distortion, lower byte count, and then lower glyph count.

## Structural-corpus evidence

Workflow `30633411868` evaluated all eleven deterministic CC0 structural classes,
three fixed glyph budgets, and the original three adaptive target modes. The
checked result is in `bench/results/rd-glyph-study/`.

That evidence showed:

- moving from 16 to 32 glyphs reduced distortion by 40.757% for 3.145% more
  container bytes;
- moving from 32 to 64 reduced distortion by a further 12.954% for 3.417% more
  bytes;
- 32 glyphs was the fixed-budget knee;
- Grammar B plus raw DEFLATE led on the synthetic structural corpus.

The earlier study remains valid comparative evidence, but its adaptive mode
labels predate the 32-primary product decision. New product-facing studies must
report the current policy explicitly and treat 16 glyphs as research-only.

## Human-raster evidence

Workflow `30636581459`, checked head
`df0708742300b344e522009a7d78a17e3f1e0359`, evaluated ten original CC0
source/grid lanes under normative `V64-P256-1`. It generated and verified 40
`.v64` files. Checked evidence is in `bench/results/human-rd-glyph/`.

At matched quality settings, fixed 64 glyphs compared with fixed 32 glyphs:

- cost **7.183%** more container bytes;
- reduced mean distortion by only **3.482%**.

The adaptive 32/64 quality path selected 32 glyphs on **all 480 frames**, making
its bytes and distortion identical to fixed 32 quality. This directly supports
32 as the primary/default budget and 64 as an explicit additional option.

Balanced 32 used **2.766% fewer bytes** than quality 32 while accepting only
**1.553% more distortion**, supporting balanced 32 as the ordinary default.

## Grammar and entropy status

The human corpus did not reproduce the synthetic Grammar B lead:

- Phase-1 plus group DEFLATE: 874,752 bytes;
- Grammar B plus group DEFLATE: 881,164 bytes;
- Grammar B plus canonical Huffman: 988,292 bytes;
- Grammar B plus Zstandard: 912,638 bytes.

Grammar B is **0.733% larger** than Phase-1 on the human gate. Final command
syntax therefore remains open pending a larger combined corpus and
cross-implementation complexity measurements.

Raw DEFLATE is **3.449% smaller** than Zstandard on the human Grammar B groups
and remains the current entropy leader. Canonical Huffman remains
noncompetitive.

## Resource evidence

Across valid human-gate files, worst decode p95 was 18.206 ms. The largest
sampled heap delta was 16,420,128 bytes and the largest sampled ArrayBuffer
delta was 2,859,280 bytes.

All seven malformed classes were rejected. Worst hostile-input p95 was 1.682 ms,
with 129,336 bytes sampled heap growth and 920,753 bytes sampled ArrayBuffer
growth.

## Current decisions

- 32 glyphs is the primary/default encoder budget.
- 64 glyphs is the explicit full-alphabet option.
- balanced is the ordinary target; quality is opt-in.
- 16 glyphs is research-only.
- the independent-group ceiling is two seconds derived from cadence.
- final grammar selection remains open.
- raw DEFLATE remains the current entropy leader without a final
  cross-implementation freeze.
