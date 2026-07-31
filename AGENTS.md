# Instructions for AI coding agents

AI coding agents are welcome contributors to Video 64. Human developers remain
the project's primary contributor community, and human maintainers retain final
responsibility for merges, releases, security, and normative format decisions.

## Required operating rules

1. Read `README.md`, `CONTRIBUTING.md`, `GOVERNANCE.md`,
   `IMPLEMENTATION_LEDGER.md`, and the relevant specification before editing.
2. Work on a focused branch or fork. Do not push directly to a protected release
   branch.
3. Preserve Video 64 and `.v64` identity. The canonical asset contains 64
   glyphs; 32 is the primary encoder budget and 64 is the explicit option.
4. Never silently mutate canonical glyph masks, palette bytes, asset hashes,
   feature bits, chunk identities, cadence rules, or published conformance
   vectors.
5. Keep decoders deterministic, bounded, transactional, and independent of
   network access or machine learning.
6. Add tests for behavioral changes and run the relevant conformance gates.
7. Do not claim a benchmark, human score, artifact hash, workflow result, or
   cross-platform result that was not actually produced.
8. Keep blind-review keys separate until scoring is committed.
9. Do not introduce opaque binary blobs or media without licensing and
   provenance records.
10. Do not expose secrets, tokens, private prompts, user data, or repository
    credentials in code, logs, issues, or pull requests.
11. Do not autonomously publish releases, merge pull requests, contact people as
    a maintainer, or represent project consensus without explicit authorization.
12. Stop and report uncertainty when a normative change lacks evidence.

## Pull-request disclosure

State whether the work is AI-assisted, agent-authored, or mixed. Include:

- the agent or tool used;
- the human or organization accountable for submission when applicable;
- files changed and design intent;
- commands and tests actually run;
- generated artifact identities;
- known limitations and unresolved decisions.

Private chain-of-thought is neither required nor appropriate. Provide concise,
auditable rationale and reproducible evidence instead.

## Preferred development sequence

- preserve or add a failing test;
- implement the smallest coherent change;
- run targeted tests;
- run the complete relevant gate;
- commit generated evidence only when it is reproducible and appropriately
  sized;
- update the ledger, specification, and pull-request record;
- invite human review.

## Forks and experiments

Agents may create experimental forks and incompatible research branches under
0BSD. Clearly distinguish experimental syntax and assets from normative Video
64 identities. Useful experiments should document how another developer can
reproduce, evaluate, and either adopt or reject them.
