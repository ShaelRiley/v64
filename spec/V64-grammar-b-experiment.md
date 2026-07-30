# V64 Grammar B command experiment

Status: experimental measurement syntax, not a normative V64 bitstream revision.

Grammar B exists to compare command choices and entropy backends without
changing the Phase 1 `.v64` container. Every backend receives the same decoded
cell states, the same command arrays, and the same independent-group
boundaries.

## State and transaction model

- A cell is `(glyph, foreground, background)`.
- Glyph values are canonical indices `0..63`.
- Palette indices use `c = ceil(log2(palette_depth))` bits.
- A packed full token therefore uses `L = 6 + 2c` bits.
- Keyframes begin from the canonical all-zero void state.
- Deltas begin from a bounded copy of the last fully validated frame.
- Commands apply to scratch state. The decoder commits scratch only after the
  complete command stream validates.
- Commands use a row-major cursor. Every non-`END` command advances at least one
  cell.
- Same-position temporal copy is `SKIP`; there is no redundant copy command.
- A decoder accepts at most `2 * cell_count + 1` commands.

## Byte and bit order

Opcodes and canonical unsigned varints are byte-aligned. Command payload fields
are packed least-significant bit first within each byte and return to a byte
boundary at the end of the command. Unused high padding bits in the final
payload byte must be zero.

For each token, fields appear in this order:

1. glyph: 6 bits
2. foreground: `c` bits
3. background: `c` bits

## Experimental opcodes

| Value | Name | Operands | Effect |
|---:|---|---|---|
| `0x00` | `END` | none | End the command stream. Remaining cells retain baseline state. |
| `0x01` | `SKIP` | positive varuint `n` | Advance `n` unchanged cells. |
| `0x02` | `LITERAL` | positive varuint `n`, then `n` packed tokens | Write `n` sequential cells. |
| `0x03` | `REPEAT_TOKEN` | positive varuint `n`, then one packed token | Write the token into `n` sequential cells. |
| `0x04` | `SET_GLYPH` | one packed 6-bit glyph | Change only the glyph and advance one cell. |
| `0x05` | `SET_FOREGROUND` | one packed `c`-bit index | Change only foreground and advance one cell. |
| `0x06` | `SET_BACKGROUND` | one packed `c`-bit index | Change only background and advance one cell. |
| `0x07` | `SET_COLOR_PAIR` | packed foreground then background | Change both colors and advance one cell. |

The reference trace builder is deterministic and greedy:

1. emit maximal `SKIP` runs;
2. emit `REPEAT_TOKEN` for three or more identical changed cells;
3. on deltas, emit a component action when exactly its named component or pair
   changed;
4. otherwise accumulate full literals;
5. emit `END`.

This parser is a reproducible baseline, not a claim that greedy parsing is
optimal. Dynamic programming or bounded beam search remains encoder-only work.

## Backend framing used by the shootout

Per-frame experiments compress `[frame_kind][command_bytes]`.

Per-group experiments concatenate records:

| Field | Width |
|---|---:|
| frame kind | 1 byte |
| packed command length | 4 bytes, little-endian |
| packed commands | declared length |

A keyframe begins a new independent group. The current golden fixture contains
one group; the next corpus experiment must compare time-based maximum group
durations.

The canonical-Huffman experiment uses a deterministic `HUF1` wrapper:

- 4-byte magic;
- 32-bit uncompressed length;
- 16-bit used-symbol count;
- 32-bit encoded bit length;
- `(symbol, code_length)` pairs in symbol order;
- canonical Huffman payload, most-significant encoded bit first.

This wrapper is deliberately self-describing so table overhead is charged.
Codes are bounded to 32 bits in the experiment. It is not normative syntax.

## Required rejection behavior

Reject:

- unknown opcodes;
- noncanonical or truncated varints;
- zero-length runs or skips;
- any cursor advance beyond the grid;
- out-of-range glyph or palette values;
- truncated packed payloads;
- nonzero payload padding bits;
- excessive command count;
- missing `END`;
- bytes after `END`.

The reference implementation is:

- `prototype/js/grammar-b.mjs`
- `prototype/js/command-benchmark.mjs`
- `prototype/js/canonical-huffman.mjs`
