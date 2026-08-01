# Native player evidence

Permanent workflow `30680126006` passed at final checked head
`0d5a1131b3ea67aeb6589d5c7f40cae852a37f6c`. Evidence artifact
`8811926753` has ZIP SHA-256
`cbedec6dc3f538d1eaae6bec7cda8aaa15bb0f87240503ff2ead49aed1e1a162`.

Reproduce the deterministic report after installing SDL2 development headers:

```bash
cargo test --locked --workspace --all-targets
cargo test --locked --workspace --all-targets --release
cargo build --locked --release --package v64-player --features native-ui
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
