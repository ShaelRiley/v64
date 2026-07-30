# Command shootout 2: packed-cost parsing and group-duration sweep

Date: 2026-07-30

This is the second measurement on the procedural golden fixture. It adds
same-value component runs, bounded dynamic programming over exact packed byte
cost, and forced 0.5-, 1-, and 2-second independent groups. It is not a
representative corpus result or a normative syntax decision.

## Reproduction

```bash
npm test
npm run bench:commands
```

Measured environment:

- Linux x64
- Node.js `v24.14.0`
- zlib `1.3.1-e00f703`
- Zstandard `1.5.7`
- input: `tests/golden/procedural.v64`
- 40×11 cells, 16 colors, 24 fps, 48 nominal frames, 2 seconds

Every entropy backend received identical commands and group boundaries within
an experiment. Every forced keyframe and entropy output was decoded and
compared with the source cell state or command stream.

## Packed command result

| Metric | Phase 1 | Grammar B v2 |
|---|---:|---:|
| Pre-entropy command bytes | 19,492 | 11,930 |
| Frame-kind plus command bytes | 19,540 | 11,978 |
| Opcode bytes | not separated | 2,005 |
| Count bytes | not separated | 1,614 |
| Packed payload bytes | not separated | 8,311 |
| Canonical trace SHA-256 | n/a | `283fd7f7b4437478a9070a819c219873a571a497fa79f228d47a961210bb5587` |

The packed-cost parser reduces command bytes by **38.795%** versus Phase 1 and
by **13.657%** versus the first greedy Grammar B trace.

The parser sometimes writes unchanged cells inside a longer literal because
that costs fewer packed bytes than splitting around them. Consequently,
`SKIP` represents 15,914 cells here rather than the earlier 16,496.

## Entropy result at the natural two-second group

| Backend and reset scope | Phase 1 | Grammar B v2 | Grammar B change |
|---|---:|---:|---:|
| Selective per-frame DEFLATE storage | 11,763 | 11,797 | +0.289% |
| Raw DEFLATE, one group | 9,540 | 9,400 | −1.468% |
| Zstandard, one group | 9,672 | 9,509 | −1.685% |
| Canonical Huffman, one group | 10,677 | 11,001 | +3.035% |

The projected v0.1 file using its unchanged selective per-frame DEFLATE policy
is 13,517 bytes, 34 bytes larger than the 13,483-byte Phase 1 golden file.

Most importantly, the packed-byte optimizer worsened one-group DEFLATE from
8,910 bytes in shootout 1 to 9,400 bytes here, a **490-byte regression**, even
while removing 1,887 packed command bytes. Exact raw-byte minimization is
therefore not an adequate proxy for entropy-coded size.

## Time-based independent-group sweep

Each record includes a one-byte frame kind and four-byte packed-command length.

| Maximum group | Groups/keyframes | Packed commands | Group input | DEFLATE | Zstandard | Canonical Huffman |
|---:|---:|---:|---:|---:|---:|---:|
| 0.5 s | 4 | 12,930 | 13,170 | 10,720 | 10,898 | 13,176 |
| 1 s | 2 | 12,232 | 12,472 | 9,897 | 10,034 | 11,718 |
| 2 s | 1 | 11,930 | 12,170 | 9,400 | 9,509 | 11,001 |

On this short, continuous-motion fixture, every additional reset costs bytes.
Relative to the two-second result:

- a one-second maximum adds 497 DEFLATE bytes;
- a half-second maximum adds 1,320 DEFLATE bytes.

This does not establish a universal two-second optimum. Scene cuts, long
duration, corruption recovery, seek latency, and low cadences are absent from
the fixture.

## Component-run utilization

| Command | Instances | Cells represented |
|---|---:|---:|
| `REPEAT_GLYPH` | 26 | 52 |
| `REPEAT_FOREGROUND` | 7 | 14 |
| `REPEAT_BACKGROUND` | 1 | 2 |
| `REPEAT_COLOR_PAIR` | 8 | 16 |

All four run forms occur, but together they cover only 84 cells. Their syntax
remains experimental until the mixed corpus shows that their gains exceed
opcode-alphabet and entropy-model costs.

## Decision

Retain the v2 trace and group sweep as instrumentation. Do not freeze the
packed-cost parser, the four component-run opcodes, the entropy backend, or the
group duration.

The next parser experiment must compare:

1. the original greedy trace;
2. the packed-byte dynamic-programming trace;
3. an entropy-aware objective estimated from the selected group backend.

That comparison must run across the legally reusable mixed corpus and report
median and 75th-percentile complete-file size, optimizer cost, peak memory,
seek latency, and corruption-recovery distance.
