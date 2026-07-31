# Subtitle-mask tranche 5 results

## Decision

The full eight-lane span-aware SM4 gate passed.

- Exact base transcription: **4/8**
- Exact SM4 transcription: **8/8**
- Base mean edge clarity: **2.375/5**
- SM4 mean edge clarity: **4.875/5**
- Base mean temporal stability: **2.875/5**
- SM4 mean temporal stability: **4.875/5**
- Mean scene preservation: **4/5**

The concealed key was opened only after the anonymous sixteen-clip worksheet was scored and committed.

## Rate accounting

Across eight two-second lanes and 192 frames:

- Broad candidate cells: **28,632**
- Temporally selected cells: **16,196**
- Stabilized cell-frames: **18,624**
- Detected stable spans: **17**
- SM4 raw-DEFLATE side-plane bytes: **9,086**
- Selected base-V64 bytes: **128,304**
- Total base V64 plus SM4: **137,390 bytes**
- Total-stream overhead: **7.082%**
- Side-plane rate: **4.543 kbit/s**

## Interpretation

Span-aware stabilization resolves both remaining failure modes:

1. Projected 60-column lecture text becomes exactly readable.
2. Static or slowly changing captions collapse into persistent consensus planes and repeat spans rather than expensive frame-local masks.

The full-plane, repeat-span, and sparse removal/upsert-delta syntax from SM2 remains sufficient. No additional decoder opcode is required.

## Outcome

The existing SM2 wire grammar plus SM3 discovery and SM4/SM5 span stabilization advances into the versioned subtitle extension. Container registration must validate grid size, palette depth, frame count, cadence-derived duration, canonical sequence decoding, timestamps, bounds, and damaged streams.

Checked workflow: `30593087909`  
Checked code head: `25b108b8572dc940362394286a1f88b63f5a7a85`
