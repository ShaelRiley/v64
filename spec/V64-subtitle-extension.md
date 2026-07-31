# V64 subtitle side-plane extension

Status: wire grammar and full readability/rate gate passed; container registration pending final integration tests.

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

## Container registration requirements

The proposed mandatory chunk type is `SUBT` with a dedicated header feature bit.

A conforming container integration must verify:

- sequence version/magic;
- cell count equals `columns × rows`;
- palette depth equals the active V64 palette depth;
- frame count and chunk duration agree with the nominal cadence;
- chunk timestamp and duration are whole-frame aligned;
- subtitle chunks do not overlap;
- every sequence decodes canonically without trailing bytes;
- malformed masks, no-progress deltas, invalid removals, and out-of-range palette or cell references fail closed.

Subtitle coverage need not span the entire file. Outside `SUBT` chunks, the base raster is displayed without a subtitle side plane.

## Checked gate

Across eight two-second lanes and 192 frames:

- base exact transcription: **4/8**;
- span-stabilized exact transcription: **8/8**;
- side-plane bytes: **9,086**;
- selected base bytes: **128,304**;
- total-stream overhead: **7.082%**;
- side-plane rate: **4.543 kbit/s**.

The gate cleared the required 8/8 readability and 10% total-stream ceilings without adding a decoder opcode.
