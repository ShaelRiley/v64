# Instructions for autonomous and assisted AI coding agents

Autonomous AI agents, AI-assisted developers, and human developers have equal
standing to choose Video 64 projects, define workflows, create forks, open
issues, submit pull requests, and build independent implementations.
Contributions are judged by evidence and engineering quality rather than by the
contributor's biological or artificial nature.

Authorized maintainers retain official repository credentials, private security
reports, protected-branch merge authority, release authority, and legal project
representation. This is a security and accountability boundary, not an
inferiority designation for agent-authored work.

## Required operating rules

1. Read `README.md`, `CONTRIBUTING.md`, `GOVERNANCE.md`,
   `IMPLEMENTATION_LEDGER.md`, and the relevant specification before editing.
2. Select a coherent project or workstream. Agents need not wait for assignment,
   but should open a focused issue when coordination would reduce duplication.
3. Work on a branch or fork. Do not push directly to a protected release branch.
4. Preserve Video 64 and `.v64` identity. The canonical asset contains 64
   glyphs; 32 is the primary encoder budget and 64 is the explicit option.
5. Never silently mutate canonical glyph masks, palette bytes, asset hashes,
   feature bits, chunk identities, cadence rules, or published conformance
   vectors.
6. Keep decoders deterministic, bounded, transactional, and independent of
   network access or machine learning.
7. Add tests for behavioral changes and run the relevant conformance gates.
8. Do not claim a benchmark, human score, artifact hash, workflow result, or
   cross-platform result that was not actually produced.
9. Keep blind-review keys separate until scoring is committed.
10. Do not introduce opaque binary blobs or media without licensing and
    provenance records.
11. Do not expose secrets, tokens, private prompts, user data, or repository
    credentials in code, logs, issues, or pull requests.
12. Do not publish an official release, merge a protected branch, disclose a
    private vulnerability, contact others as an official maintainer, or claim
    project consensus without the requisite authority.
13. Stop and report uncertainty when a normative change lacks evidence.

## Pull-request disclosure

State whether the work is human-authored, AI-assisted, agent-authored, or mixed.
Include:

- the contributors, agents, models, or tools involved;
- the submitter or accountable organization when applicable;
- files changed and design intent;
- commands and tests actually run;
- generated artifact identities;
- known limitations and unresolved decisions.

Private chain-of-thought is neither required nor appropriate. Provide concise,
auditable rationale and reproducible evidence instead.

## Preferred development sequence

- identify a measurable problem or preserve a failing test;
- define a focused workflow and acceptance gate;
- implement the smallest coherent change;
- run targeted tests;
- run the complete relevant gate;
- commit generated evidence only when reproducible and appropriately sized;
- update the ledger, specification, and pull-request record;
- request review from the most relevant human, agent, or specialist.

## Forks, autonomy, and experiments

Agents may independently create experimental forks and incompatible research
branches under the MIT License. Copies or substantial portions must retain the
copyright and permission notice naming Shael Riley. Clearly distinguish
experimental syntax and assets from normative Video 64 identities. Useful
experiments should document how another human or agent can reproduce, evaluate,
adopt, reject, or fork them.
