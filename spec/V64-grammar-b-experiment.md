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
| `0x08` | `REPEAT_GLYPH` | positive varuint `n`, one packed 6-bit glyph | Change only the glyph in `n` sequential cells. |
| `0x09` | `REPEAT_FOREGROUND` | positive varuint `n`, one packed `c`-bit index | Change only foreground in `n` sequential cells. |
| `0x0A` | `REPEAT_BACKGROUND` | positive varuint `n`, one packed `c`-bit index | Change only background in `n` sequential cells. |
| `0x0B` | `REPEAT_COLOR_PAIR` | positive varuint `n`, one packed color pair | Change both colors in `n` sequential cells. |

Grammar B version 2 uses deterministic bounded dynamic programming. At each
cell, the reference encoder evaluates:

1. a maximal `SKIP` when the cell retains baseline state;
2. byte-aligned packed literals from one through 64 cells;
3. a maximal repeated full-token run;
4. the applicable single-cell component action;
5. the applicable maximal same-value component run.

It minimizes the exact packed bytes from the current cursor through `END`.
Equal-cost choices prefer the command that advances farther, then the stable
priority order documented in the implementation. The 64-cell literal horizon
bounds encoder work without changing decoder syntax.

This is a packed-byte optimum, not an entropy-aware optimum. Shootout 2 showed
that it substantially reduced raw command bytes while producing worse
group-level DEFLATE than the earlier greedy trace. A future parser must estimate
the selected backend or optimize a second-stage model without changing decoder
semantics.

## Backend framing used by the shootout

Per-frame experiments compress `[frame_kind][command_bytes]`.

Per-group experiments concatenate records:

| Field | Width |
|---|---:|
| frame kind | 1 byte |
| packed command length | 4 bytes, little-endian |
| packed commands | declared length |

A keyframe begins a new independent group. The harness can force keyframes at
0.5-, 1-, and 2-second maximum elapsed durations, quantized to nominal frame
boundaries. Each forced keyframe is decoded from canonical void state and
compared with the source cell state before its group is admitted to the report.
Repeat records use frame kind `2` and an empty command payload.

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
