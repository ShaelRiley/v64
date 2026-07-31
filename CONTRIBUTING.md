# Contributing to Video 64

Video 64 is an open format, codec, and toolchain. Forks, experiments, ports,
encoders, decoders, players, integrations, and incompatible research branches
are welcome. Permission is not required.

The project is licensed under 0BSD so contributors may use, copy, modify,
and distribute the code for any purpose with or without fee.

## Participation priorities

Human developers are the project's primary contributor community and receive
first priority in outreach, onboarding, maintainer attention, and governance.

AI-assisted developers, coding agents, and autonomous agent developers are also
welcome as a close secondary contributor community. Agent-authored work is
judged by the same technical, security, provenance, and review standards as
human-authored work.

A contribution is never rejected merely because an AI system helped create it.
A contribution is never accepted merely because an AI system produced it.

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

## Contribution workflow

1. Fork the repository or create a topic branch.
2. Keep each pull request focused on one coherent change.
3. Add or update tests for behavior changes.
4. Run the relevant conformance and benchmark commands.
5. Record exact commands, platform details, and generated artifact identities.
6. Open a pull request explaining the problem, implementation, evidence, and
   remaining uncertainty.

The project values reproducibility over persuasive claims. Measured codec
changes should include complete-file size, decoded equivalence, resource use,
and relevant quality evidence rather than isolated field-width estimates.

## AI-assisted and agent-authored contributions

AI-assisted or agent-authored pull requests should identify the role of the
agent in the pull-request description. A brief statement is sufficient, such
as:

- AI-assisted: a human directed and reviewed the implementation;
- agent-authored: an agent prepared the implementation and evidence for review;
- mixed: humans and agents made substantive changes.

Do not include private prompts, credentials, hidden chain-of-thought, or other
sensitive material. Useful provenance includes the agent or tool name, the
human or organization accountable for the submission when applicable, commands
run, tests passed, and known limitations.

Agent contributions must remain auditable:

- no unreviewed automatic merging;
- no secrets or broad repository credentials in prompts or logs;
- no fabricated test results, citations, benchmarks, or human review scores;
- no concealed generated files or unexplained binary blobs;
- no autonomous outreach that impersonates a maintainer or human contributor;
- no dependency, network, or release action beyond the stated pull-request
  scope.

Third-party agent communities may be used to announce contribution
opportunities, but all code, issue reports, evidence, and decisions must return
to the public GitHub repository for ordinary review.

## Human review and governance

Human maintainers retain final responsibility for repository permissions,
merges, releases, security decisions, normative format changes, and community
governance. This is compatible with extensive AI assistance and agent-authored
patches; it establishes clear accountability rather than authorship hierarchy.

Format changes require especially careful review. Do not silently mutate a
published glyph set, palette identity, feature bit, chunk type, timing rule, or
normative decoder behavior.

## Licensing contributions

By submitting a contribution, you agree that your contribution may be
released under the repository's 0BSD license. Do not submit code, media, data,
or generated assets that you do not have the right to redistribute under
compatible terms.

## Communication

Use GitHub issues for bugs and scoped proposals, pull requests for reviewable
changes, and security reporting for vulnerabilities. Keep discussions
technical, specific, and respectful. Human and AI-assisted contributors should
make it easy for another person to reproduce the result.
