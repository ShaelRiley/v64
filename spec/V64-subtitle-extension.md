# V64 subtitle side-plane extension

Status: wire grammar, full readability/rate gate, and JavaScript proof-container integration passed.

## Purpose

The subtitle side plane preserves text edges that cannot be represented reliably by the canonical 64-glyph base video path, especially at 60 columns.

The extension is sparse and presentation-compatible: it composites exact 8×16 masks over decoded base cells without replacing the base video timeline.

## Sequence grammar

The checked sequence syntax is the existing `SM2` grammar:

- full plane;
- repeat-plane span;
- sparse cell-removal and cell-upsert delta.

Each entry carries:

- row-major cell index;
- foreground palette index;
- background palette index;
- sixteen one-byte mask rows.

Entries must be strictly increasing by cell index. Packet parsing must always make progress. Palette references and cell indexes are bounded by the active V64 header.

## Encoder selection

The encoder may use later selector generations while preserving the same wire syntax:

- SM3 connected-region and horizontal temporal projection;
- SM4 persistent consensus masks;
- SM5 deterministic changing-caption span boundaries and sparse-transition merging.

Selector generation is encoder behavior, not decoder syntax.

## Container registration

The mandatory chunk type is `SUBT`. Its mandatory header feature bit is `0x80`.
Feature bits above `0x80` remain unknown mandatory bits in the current proof
profile and must fail closed.

A conforming container integration verifies:

- sequence version/magic;
- cell count equals `columns × rows`;
- palette depth equals the active V64 palette depth;
- frame count and chunk duration agree with the nominal cadence;
- chunk timestamp and duration are whole-frame aligned;
- each chunk ends within the declared file duration;
- subtitle chunks do not overlap;
- chunk presence and feature bit `0x80` agree;
- every sequence decodes canonically without trailing bytes;
- malformed masks, no-progress deltas, invalid removals, and out-of-range palette or cell references fail closed.

Subtitle coverage need not span the entire file. Outside `SUBT` chunks, the base raster is displayed without a subtitle side plane.

## Checked readability/rate gate

Across eight two-second lanes and 192 frames:

- base exact transcription: **4/8**;
- span-stabilized exact transcription: **8/8**;
- side-plane bytes: **9,086**;
- selected base bytes: **128,304**;
- total-stream overhead: **7.082%**;
- side-plane rate: **4.543 kbit/s**.

The gate cleared the required 8/8 readability and 10% total-stream ceilings without adding a decoder opcode.

## Checked container gate

Clean GitHub Actions workflow `30598259834` at code head
`c710c8b5e85399d5d1d35ed65ca6829755a0a7d3` passed all 96 repository tests,
built a deterministic `SUBT` container, independently verified it, and uploaded
artifact `8780957363`.

Fixture identity:

- filename: `subt-container.v64`;
- bytes: **528**;
- SHA-256:
  `2535ea2368fe562dcc9ec46b6b6cdb216ad797a7f1b735753719101180b9935a`;
- feature flags: `0xB9`;
- video frames: **6**;
- subtitle chunks: **2**;
- subtitle frames: **5**;
- sparse base-only gap: **1 frame**.

The complete checked record is in `bench/results/subt/RESULTS.md` and
`bench/results/subt/summary.json`.
