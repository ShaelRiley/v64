# Rust resource and rollback gate

This checked milestone adds a caller-selectable inflated-chunk ceiling beneath the immutable compiled hard ceiling, plus malformed Phase-1 frame vectors that perform partial internal writes before rejection.

- Stored DEFLATE bytes: 79
- Inflated bytes: 65,536
- Expansion ratio: approximately 829.569:1
- Resource cases: 3 × 64 iterations
- Rollback cases: 5 × 64 iterations
- Exact configured boundary accepted: yes
- Zero and above-hard-ceiling limits rejected: yes
- Prior frame state remained immutable: yes
- A valid delta decoded identically after every malformed vector: yes

Licensed under MIT. Copyright (c) 2026 Shael Riley.
