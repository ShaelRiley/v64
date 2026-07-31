from pathlib import Path

path = Path("crates/v64-core/src/bin/v64-resource-gate.rs")
text = path.read_text()
text = text.replace(
    "let fingerprint = fingerprint(&baseline);",
    "let baseline_fingerprint = fingerprint(&baseline);",
)
text = text.replace(
    "if fingerprint(&exact) != fingerprint {",
    "if fingerprint(&exact) != baseline_fingerprint {",
)
text = text.replace(
    "if fingerprint(&recovered) != fingerprint {",
    "if fingerprint(&recovered) != baseline_fingerprint {",
)
text = text.replace(
    '"valid_reparse_fingerprint": fingerprint,',
    '"valid_reparse_fingerprint": baseline_fingerprint.clone(),',
)
text = text.replace(
    '"valid_fingerprint": fingerprint,',
    '"valid_fingerprint": baseline_fingerprint,',
)
path.write_text(text)

path = Path("crates/v64-core/src/bin/v64-frame-rollback-gate.rs")
text = path.read_text().replace(
    'bytes.iter().map(|byte| format!("{byte:02x}")).collect()',
    'bytes.iter().map(|byte| format!("{byte:02x}")).collect::<Vec<_>>().join("")',
)
path.write_text(text)
