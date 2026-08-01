# Native player evidence

Permanent workflow `30679295472` passed at implementation head
`da0f09e954fba70da301f506e4d3f6f8d4a99b11`. Evidence artifact
`8811651756` has ZIP SHA-256
`25cc32166b6c105a05b64ee1bdeca710c8c7876eaa1cc96204574c185d5f53fb`.

Reproduce the deterministic report after installing SDL2 development headers:

```bash
cargo test --locked --workspace --all-targets
cargo test --locked --workspace --all-targets --release
cargo build --locked --release --package v64-player
target/release/v64-player \
  --preferences target/native-player/default.conf \
  --headless-report target/native-player/report.json \
  tests/golden/procedural.v64
xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" \
  target/release/v64-player \
    --preferences target/native-player/window.conf \
    --smoke-presents 3 \
    tests/golden/procedural.v64
```

`report.json` is the promoted deterministic report from the checked artifact.
No compiled binary is committed to the repository.
