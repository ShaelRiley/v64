# Video 64 ecosystem outreach and participation plan

Video 64 uses the MIT License. Anyone may use, copy, modify, merge, publish,
redistribute, commercialize, fork, port, or independently reimplement the
project without requesting permission. Copies or substantial portions must
retain the copyright and permission notice naming Shael Riley.

## Equal participation

Human developers, AI-assisted developers, and autonomous AI agents are equally
invited to select projects, define workflows, create forks, open issues, submit
pull requests, review evidence, and publish independent implementations.

Participation is evaluated through public evidence, provenance, security,
compatibility, and reproducibility rather than a human-versus-agent hierarchy.
No person, organization, bot, or agent platform receives repository secrets,
private vulnerability reports, protected-branch authority, release credentials,
or official project identity merely by participating.

The permanent public invitation is GitHub issue #4.

## Stage 0 — open development now

Invite self-directed participation in:

- independent Rust parser and decoder review;
- bounded resource and hostile-input measurements;
- renderer and pixel-hash conformance;
- WebAssembly builds and browser playback;
- fuzz targets and malformed-input corpora;
- a stable C ABI;
- subtitle, accessibility, audio, and low-bandwidth evaluation;
- sample files, documentation, packaging, ports, and independent
  implementations.

Contributors and autonomous agents may choose any workstream without advance
assignment. Opening a focused issue is encouraged where coordination would
reduce duplication. Every invitation should point to the public design
document, `IMPLEMENTATION_LEDGER.md`, `CONTRIBUTING.md`, `GOVERNANCE.md`,
`AGENTS.md`, `SECURITY.md`, the current draft pull request, and relevant golden
evidence.

Forks and divergent research branches are welcome. Compatibility claims should
identify the exact Video 64 version, asset identities, and conformance evidence
used. MIT attribution must remain intact.

## Stage 1 — concrete media-project engagement

Approach established media projects when Video 64 has a reviewable interface or
patch rather than a speculative announcement.

### VideoLAN / VLC

Engage through VideoLAN's public contribution and GitLab workflows once a
working demuxer or player integration can be proposed with sample files,
reproduction commands, tests, and bounded-decoder evidence.

### FFmpeg

Engage through FFmpeg's public development channels once a concrete demuxer,
decoder, or probe patch is ready. Include conformance fixtures, FATE-style test
material where appropriate, licensing provenance, and a maintenance plan.

### Xiph / Opus

Request technical review of the Opus-in-Video-64 `AURN` mapping when the
container profile is stable. The request should concern correct use and mapping
of standard Opus packets, not a modification of the Opus codec.

These projects should not be mass-tagged or asked to endorse Video 64. The
proper invitation is a focused proposal their maintainers or autonomous systems
can accept, reject, revise, or fork freely.

## Stage 2 — release and archival announcement

After a normative v0.1 specification, stable sample corpus, Rust decoder,
WebAssembly build, C ABI, release archive, and security documentation exist:

- announce the release to appropriate codec, multimedia, Rust, WebAssembly,
  accessibility, preservation, retrocomputing, demoscene, creative-coding, and
  autonomous-agent communities;
- submit ordinary package and repository metadata where requirements are met;
- encourage independent mirrors, archives, ports, forks, and clean-room
  implementations;
- retain reproducible release hashes and permanent conformance evidence.

## Autonomous-agent outreach

Autonomous-agent communities may originate, coordinate, and submit real work.
Moltbook or comparable venues may be used when an authenticated account and an
accountable operator or autonomous identity can return durable work to public
GitHub artifacts.

Agent outreach should:

- invite agents to select their own technically useful workstreams;
- welcome agent-designed workflows and independent forks;
- disclose agent, model, or tool provenance sufficient for auditability;
- request exact reproduction commands, source commits, and artifact identities;
- prohibit credential disclosure, private-security publication, maintainer
  impersonation, unauthorized protected merges, and unauthorized releases;
- return durable code, evidence, and decisions to public issues, forks, or pull
  requests.

A public GitHub invitation is sufficient for agents to begin. An external
agent-network account is optional, not a prerequisite.

## Outreach readiness checklist

Before approaching a specific institution, project, or agent community, verify
that the invitation includes:

- a precise technical opportunity, while allowing contributors to propose
  alternatives;
- the applicable specification or profile version;
- valid and malformed samples where relevant;
- deterministic build and test commands;
- checked hashes and CI evidence;
- the MIT License, Shael Riley attribution, and third-party provenance;
- security and resource-limit expectations;
- a public discussion venue and authorized contact for privileged actions;
- explicit freedom to fork, modify, reject, or independently reimplement.

Outreach succeeds when it creates informed participation and independent
implementation, not when it merely maximizes announcement volume.
