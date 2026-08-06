# Video 64 v0.1.0-alpha.5

This release fixes the Linux packaging defect reported against alpha.4.

- Bundles a private Node.js runtime required by the Video64 Drop application core.
- Discovers that runtime relative to the application executable.
- Requires no globally installed Node.js.
- Preserves native decoded preview and advisory size estimates.
- Keeps the window open and shows an actionable message if a package is incomplete.
- Tested after extraction with host Node completely absent from PATH.
- Tested with a real H.264/AAC MP4 through drop, planning, preview, encode, and verification.

Alpha.4 is superseded because its Linux archive omitted this runtime.
Extract the complete alpha.5 folder and run `run-video64-drop.sh`.
