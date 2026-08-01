# Checked Rust hostile-input and resource gate

Status: **passed**

Checked code head: `bbcd0fae408801369b66888ada14ae1749a41541`

GitHub Actions workflow: `30648764459` (`V64 Rust hostile-input and resource gate`)

Artifact: `v64-rust-hostile-input`, ID `8800518126`

Artifact ZIP SHA-256:
`5c1d640ffa154b2ef8924c5b0205e9d3b3629236f35edac206604e15d764640a`

Canonical report SHA-256:
`27b6494aab8f804adcb3290da46ad1b7c42c16c1c70a32eb1e2356f3e4375b0b`

## Checked result

- malformed cases: 29;
- repetitions per case: 64;
- complete runs: 2;
- report identity: byte-for-byte equal across both runs;
- valid fixture size: 13,483 bytes;
- valid fingerprint: `120000:49:1:11787:19564:40x11`;
- first-run wall time: 0.04 seconds;
- first-run peak RSS: 2,672 KiB;
- required process cap: 10 seconds per run;
- required RSS ceiling: 262,144 KiB.

Every hostile case rejected with the same error across all 64 repetitions. The
original valid fixture parsed successfully after each case and reproduced the
same fingerprint, demonstrating stateless parser recovery for this corpus.

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
- byte-identical canonical reports across duplicate complete runs;
- successful valid-file reparse after every hostile case;
- process-level wall-time and maximum-resident-set measurement.

The report format is `V64-RUST-HOSTILE-GATE-1`. Timing and peak RSS remain in
separate `/usr/bin/time -v` records so the canonical semantic report is stable.

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
