# Command shootout 1: procedural golden fixture

Date: 2026-07-29

This is the first backend-neutral visual-command measurement. It is one
procedural fixture, not a representative corpus and not a normative entropy
selection.

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
- 40×11 cells, 16 colors, 24 fps, 48 coded frames, 2 seconds
- one independent group

All reported backends received identical decoded states, command arrays, and
group boundaries. Every experimental entropy output was decoded and compared
with its input during the benchmark.

## Command results

| Metric | Phase 1 | Grammar B |
|---|---:|---:|
| Pre-entropy command bytes | 19,492 | 13,817 |
| Frame-kind plus command bytes | 19,540 | 13,865 |
| Opcode bytes | not separated | 4,637 |
| Count bytes | not separated | 2,576 |
| Packed payload bytes | not separated | 6,604 |
| Canonical trace SHA-256 | n/a | `92a92508e215747a1d4e3532966d63a02662e0591697c48ea9aa22d2e69dfa85` |

Grammar B reduced the pre-entropy command stream by **29.115%**. Its 4,637
opcode bytes show why component-run aggregation and a cost-minimizing parser
remain important.

## Entropy results

Values below include the tested entropy wrapper but exclude the `.v64`
container header, chunk headers, index, and unrelated tracks.

| Backend and reset scope | Phase 1 | Grammar B | Grammar B change |
|---|---:|---:|---:|
| Packed only, per-frame payload | 19,540 | 13,865 | −29.043% |
| Raw DEFLATE, separate frame | 11,763 | 11,782 | +0.162% |
| Zstandard, separate frame | 12,636 | 12,366 | −2.137% |
| Canonical Huffman, separate frame | 13,935 | 17,311 | +24.227% |
| Raw DEFLATE, one independent group | 9,540 | 8,910 | −6.604% |
| Zstandard, one independent group | 9,672 | 9,089 | −6.027% |
| Canonical Huffman, one independent group | 10,677 | 10,210 | −4.374% |

Per-frame DEFLATE reverses the packed-stream advantage on this fixture:
Grammar B is 5,675 command bytes smaller before compression but 19 bytes larger
after 48 separate DEFLATE resets. With one group-level reset, Grammar B becomes
630 bytes smaller than Phase 1.

The existing container selectively DEFLATE-compresses each frame. Replacing its
Phase 1 command payloads with Grammar B under that unchanged policy projects a
13,502-byte file versus the existing 13,483-byte golden file: again, **19 bytes
larger**. This projection preserves current framing and therefore must not be
confused with a group-chunk container result.

## Opcode utilization

| Grammar B command | Instances | Cells represented |
|---|---:|---:|
| `SKIP` | 1,293 | 16,496 |
| `LITERAL` | 1,224 | 2,306 |
| `REPEAT_TOKEN` | 58 | 304 |
| `SET_GLYPH` | 1,243 | 1,243 |
| `SET_FOREGROUND` | 340 | 340 |
| `SET_BACKGROUND` | 121 | 121 |
| `SET_COLOR_PAIR` | 310 | 310 |
| `END` | 48 | n/a |

Separate component actions are empirically active, but their 2,014 single-cell
opcode instances are also an obvious optimization target.

## Decision

Retain Grammar B as the next experimental baseline. Do **not** freeze an entropy
backend or change the v0.1 container from this fixture.

The measurement supports four immediate conclusions:

1. packed command size alone is not a reliable file-size proxy;
2. independent-group duration and entropy reset scope are coupled decisions;
3. canonical Huffman table overhead is prohibitive per frame here but less
   damaging per group;
4. the greedy component parser needs same-value runs and exact cost
   optimization before syntax is frozen.

## Next experiment

Run the identical harness over the legally reusable mixed corpus with 0.5-, 1-,
and 2-second maximum independent groups. Add same-value component runs and a
dynamic-programming or bounded-beam command parser, then report median and 75th
percentile complete-file size, decoder memory, encode cost, seek latency, and
corruption-recovery distance.
