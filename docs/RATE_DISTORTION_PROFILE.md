# V64 scene-cut and rate-distortion profile

Status: checked JavaScript proof-profile behavior

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
| `compact` | 16 | 0.82 | 0.75 | 0.58 |
| `balanced` | 16, 32 | 0.48 | 4 | 0.44 |
| `quality` | 16, 32, 64 | 0.18 | 16 | 0.34 |

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
three fixed glyph budgets, and all three target modes. The checked result is in
`bench/results/rd-glyph-study/`.

Current evidence supports:

- `compact` as the smallest target;
- `quality` as the lowest-distortion target;
- 32 glyphs as the provisional fixed-budget knee;
- Grammar B plus raw DEFLATE as the current grammar/backend leader.

These findings are not a final wire-format freeze. The same study must pass on
the reusable human raster corpus, with decoder cost and allocation measurements,
before the grammar or entropy backend becomes normative.
