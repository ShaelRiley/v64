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

The maximum independent-group duration remains **48 frames at 24 fps**, or two
seconds. A scene cut may begin a new group earlier but may never extend a group
past that maximum. Every group begins with a self-contained keyframe.

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

## Checked corpus result

Workflow `30633411868` evaluated all eleven deterministic CC0 structural classes,
three fixed glyph budgets, and the original three adaptive target modes. The
checked result is in `bench/results/rd-glyph-study/`.

That evidence showed:

- moving from 16 to 32 glyphs reduced distortion by 40.757% for 3.145% more
  container bytes;
- moving from 32 to 64 reduced distortion by a further 12.954% for 3.417% more
  bytes;
- 32 glyphs is therefore the fixed-budget knee and is now the primary default;
- Grammar B plus raw DEFLATE remains the current grammar/backend leader.

The earlier study remains valid comparative evidence, but its adaptive mode
labels predate the 32-primary product decision. New studies must report the
current policy explicitly and treat 16 glyphs as research-only.

These findings are not a final wire-format freeze. The same study must pass on
the reusable human raster corpus, with decoder cost and allocation measurements,
before the grammar or entropy backend becomes normative.
