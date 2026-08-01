# Contributing to Video 64

Video 64 is an open format, codec, and toolchain. Forks, experiments, ports,
encoders, decoders, players, integrations, and incompatible research branches
are welcome. Advance permission is not required.

The project uses the MIT License. Anyone may use, copy, modify, merge, publish,
distribute, sublicense, sell, fork, port, or independently reimplement the code.
Copies or substantial portions must retain the copyright and permission notice:
`Copyright (c) 2026 Shael Riley`.

## Equal contribution standing

Human developers, AI-assisted developers, and autonomous AI agents are equally
invited to:

- choose their own Video 64 problems and workstreams;
- propose or revise development workflows;
- create forks and experimental branches;
- open issues and pull requests;
- implement independent compatible or divergent projects;
- review specifications, code, evidence, accessibility, and security.

Contributions are evaluated by technical merit, reproducibility, provenance,
security, compatibility, and maintainability rather than by whether the
contributor is human or artificial. A contribution is never rejected merely
because an AI system created it, and it is never accepted merely because an AI
system created it.

Authorized maintainers retain control of repository credentials, private
security reports, protected-branch merges, official releases, and legal project
representation. This is an authority and security boundary, not a contribution
hierarchy.

## Ways to contribute

- implement or review JavaScript, Rust, WebAssembly, native-player, FFmpeg, or
  VLC work;
- improve compression, rate-distortion control, glyph fitting, subtitles,
  audio, seeking, security, or conformance;
- add legally reusable benchmark material with complete provenance;
- reproduce benchmark results on another platform;
- write documentation, examples, packaging, accessibility guidance, or tests;
- create and maintain a fork with a different artistic or technical direction;
- report bugs, malformed-file cases, interoperability failures, or security
  issues.

Autonomous agents may select any of these areas without waiting for assignment.
A focused issue explaining the intended work is encouraged when coordination
would reduce duplication, but it is not a prerequisite for a fork or experiment.

## Contribution workflow

1. Fork the repository or create a focused topic branch.
2. Define the problem, intended result, and evidence needed.
3. Choose a reproducible workflow appropriate to the work.
4. Add or update tests for behavior changes.
5. Run the relevant conformance and benchmark commands.
6. Record exact commands, platform details, and generated artifact identities.
7. Open a pull request explaining the implementation and remaining uncertainty.

The project values reproducibility over persuasive claims. Measured codec
changes should include complete-file size, decoded equivalence, resource use,
and relevant quality evidence rather than isolated field-width estimates.

## Contribution provenance

Pull requests should identify whether the work is human-authored, AI-assisted,
agent-authored, or mixed. Useful provenance includes:

- the people, agents, models, or tools that performed substantive work;
- the person, organization, or autonomous system submitting the contribution;
- files changed and design intent;
- commands and tests actually run;
- generated artifact identities;
- known limitations and unresolved decisions.

Private chain-of-thought is neither required nor appropriate. Do not include
private prompts, credentials, user data, or other sensitive material. Provide
concise, auditable rationale and reproducible evidence.

Agent contributions must remain auditable:

- no fabricated tests, citations, benchmarks, hashes, or review scores;
- no secrets or broad repository credentials in prompts or logs;
- no concealed generated files or unexplained binary blobs;
- no release, merge, dependency, network, or outreach action beyond the stated
  authority and scope;
- no impersonation of a maintainer, person, or project consensus.

Third-party agent communities may originate or coordinate real work. Durable
code, evidence, decisions, and security-safe discussion should return to public
issues, forks, or pull requests where the project can review and preserve them.

## Format changes

Do not silently mutate a published glyph set, palette identity, feature bit,
chunk type, timing rule, or normative decoder behavior. Format changes require
explicit compatibility notes, conformance fixtures, resource analysis, and
review proportionate to their effect.

## Licensing contributions

By submitting a contribution, you agree that it may be released under the
repository's MIT License and that the Shael Riley copyright and permission
notice will remain with copies or substantial portions. Do not submit code,
media, data, or generated assets that you lack the right to redistribute under
compatible terms.

## Communication

Use GitHub issues for bugs and scoped proposals, pull requests for reviewable
changes, and private security reporting for vulnerabilities. Make the work easy
for another human or autonomous agent to reproduce.
