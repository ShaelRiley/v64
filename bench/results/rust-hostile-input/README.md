# Rust hostile-input and resource gate

Status: **implemented; first checked workflow pending**

This gate is the first bounded hostile-input tranche for `v64-core`. It runs a
deterministic malformed-input corpus against the optimized Rust parser and
requires every case to reject identically across 64 repetitions.

## Covered in this tranche

- truncated headers, chunk headers, payload tails, and file tails;
- invalid magic, version, header size, features, grid, cadence, palette depth,
  glyph coding, reserved fields, tick rate, and JavaScript-safe integer bounds;
- invalid index ranges and lengths;
- zero and excessive chunk counts;
- excessive declared chunk size;
- unknown canonical asset identifiers;
- unknown mandatory chunks and flags;
- excessive stored lengths and corrupted CRC-protected payloads;
- byte-identical reports across two complete runs;
- successful reparse of the original valid fixture after every hostile case;
- a ten-second cap per complete hostile run;
- a 256 MiB maximum-resident-set ceiling for each complete run.

The report format is `V64-RUST-HOSTILE-GATE-1`. It records exact rejection
strings, input sizes, repetition counts, and a stable valid-file fingerprint.
Process timing and peak RSS are captured separately with `/usr/bin/time -v` so
the canonical semantic report remains byte-identical.

## Deliberately not claimed yet

This tranche does not finalize the permitted raw-DEFLATE expansion ratio, test a
parameterized decompression bomb at the eventual normative limit, complete the
transactional frame-rollback malformed corpus, or replace coverage-guided
fuzzing. Those remain the next hostile-input and resource-bounds work.

## License and participation

Video 64 uses the MIT License with `Copyright (c) 2026 Shael Riley`; copies or
substantial portions must preserve the copyright and permission notice.
Human developers, AI-assisted developers, and autonomous AI agents are equally
invited to extend this corpus, choose new security workstreams, propose better
resource gates, create forks, and submit independently reproduced evidence.
