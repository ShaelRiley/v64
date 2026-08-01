# Rust fuzzing and allocation-regression gates

Video 64 keeps seven permanent coverage-guided Rust targets:

| Target | Surface |
|---|---|
| `container_parse` | Header, chunk, CRC, index, raw-DEFLATE, and aggregate payload bounds |
| `phase1_frame` | Transactional Phase-1 command decoding |
| `grammar_b` | Direct packed Grammar B decoding |
| `renderer` | Grid, asset, palette, token, multiplication, and output-layout boundaries |
| `subtitles` | SM2 parsing, canonicalization, repeat expansion, and allocation limits |
| `audio` | AURN packet, length, trim, sample, and timeline validation |
| `wasm_accessors` | WebAssembly-facing renderer metadata and byte-access boundaries |

The targets live under `fuzz/` and use `cargo-fuzz` with libFuzzer. Every target
is deterministic, offline, and supplied with explicit allocation or input-size
bounds. The fuzz package is separate from the release workspace and does not
alter decoder dependencies.

## Curated seed corpus

Generate the corpus from the checked project fixture and project-authored
structural inputs:

```bash
node tools/build-rust-fuzz-corpus.mjs target/fuzz-corpus
```

The command writes raw per-target seeds plus `manifest.json`, including byte
lengths, SHA-256 identities, and provenance. CI builds the corpus twice and
requires byte-identical manifests. The only media-derived seed is the existing
project-owned deterministic `tests/golden/procedural.v64` fixture. No arbitrary
third-party media or opaque blobs are added.

## Local smoke run

Use Rust 1.85.0 for the workspace and the separately pinned nightly toolchain
for libFuzzer instrumentation:

```bash
rustup toolchain install 1.85.0 --profile minimal
rustup toolchain install nightly-2025-02-20 --profile minimal
cargo install cargo-fuzz --version 0.12.0 --locked
node tools/build-rust-fuzz-corpus.mjs target/fuzz-corpus
cargo test --locked --workspace --all-targets
cargo run --locked --release --bin v64-allocation-gate -- target/allocation-report.json
```

Run one target deterministically:

```bash
mkdir -p target/fuzz-artifacts/container_parse
cargo +nightly-2025-02-20 fuzz run container_parse target/fuzz-corpus/container_parse -- \
  -runs=512 -seed=1 -workers=1 -jobs=1 -max_len=65536 -timeout=10 \
  -rss_limit_mb=2048 \
  -artifact_prefix=target/fuzz-artifacts/container_parse/
```

Replace the target and corpus directory to exercise another surface. The pull
request workflow uses 512 runs per target. The weekly schedule and the `deep`
manual profile use 20,000 runs per target.

## Reproduce a failure

libFuzzer writes the minimizing input under the target's artifact directory.
Re-run it with:

```bash
cargo +nightly-2025-02-20 fuzz run TARGET path/to/crash-artifact
```

Do not commit a crash input until it has been reduced, inspected for provenance
and sensitive data, and assigned to the appropriate target corpus. A promoted
regression seed must retain the MIT notice and a human-readable explanation of
the defect it preserves.

## Deterministic allocation gate

`v64-allocation-gate` avoids fragile microbenchmarks. It checks exact sizes,
compiled ceilings, deterministic rejection messages, and valid recovery after
repeated malformed inputs. Its report covers:

- the maximum 262,144-cell frame state and 134,217,728-byte RGBA layout;
- invalid grid and multiplication boundaries before allocation;
- excessive container lengths, chunk counts, per-chunk inflation, and aggregate
  decoded payload budgets;
- non-advancing pathological Phase-1 command streams;
- transactional Phase-1 and Grammar B recovery;
- SM2 frame and canonical-entry ceilings, including repeat-expansion attacks;
- AURN packet-count, packet-data, and timing limits;
- the last valid and first invalid WebAssembly renderer byte indexes.

CI creates each allocation and expansion report twice, requires byte identity,
hashes both canonical reports, and retains them with fuzz failure artifacts.
