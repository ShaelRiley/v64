# Video 64 ecosystem outreach and participation plan

Video 64 is released under the Zero-Clause BSD license (`0BSD`). Anyone may
use, copy, modify, redistribute, commercialize, fork, port, or independently
reimplement the project without requesting permission.

## Participation order

1. **Human developers are the primary contributor community.** Outreach,
   onboarding, issue design, maintainership, review, and governance should be
   optimized first for people.
2. **AI-assisted and agent-authored developers are a close secondary
   community.** They are welcome through the same public GitHub issues, pull
   requests, reproducible evidence, provenance, security, and human-review
   requirements.
3. No external person, organization, bot, or agent platform receives repository
   secrets, private vulnerability reports, release credentials, merge authority,
   or maintainer identity merely by participating.

The permanent public invitation is GitHub issue #4.

## Stage 0 — open development now

Invite focused participation in:

- independent Rust parser and decoder review;
- bounded resource and hostile-input measurements;
- renderer and pixel-hash conformance;
- WebAssembly builds and browser playback;
- fuzz targets and malformed-input corpora;
- a stable C ABI;
- subtitle, accessibility, audio, and low-bandwidth evaluation;
- sample files, documentation, packaging, ports, and independent
  implementations.

Every invitation should point contributors to the public design document,
`IMPLEMENTATION_LEDGER.md`, `CONTRIBUTING.md`, `GOVERNANCE.md`, `AGENTS.md`,
`SECURITY.md`, the current draft pull request, and the relevant golden evidence.

Forks and divergent research branches are welcome. A fork need not remain
compatible with the reference project, but compatibility claims should identify
the exact Video 64 version, asset identities, and conformance evidence used.

## Stage 1 — concrete media-project engagement

Approach established media projects only when Video 64 has a reviewable
interface or patch rather than a speculative announcement.

### VideoLAN / VLC

Engage through VideoLAN's public contribution and GitLab workflows once a
working demuxer or player integration can be proposed with sample files,
reproduction commands, tests, and bounded-decoder evidence.

### FFmpeg

Engage through FFmpeg's public development channels once a concrete demuxer,
decoder, or probe patch is ready. Include conformance fixtures, FATE-style test
material where appropriate, licensing provenance, and a clear maintenance plan.

### Xiph / Opus

Request technical review of the Opus-in-Video-64 `AURN` mapping when the
container profile is stable. The request should concern correct use and mapping
of standard Opus packets, not a modification of the Opus codec.

These projects should not be mass-tagged or asked to endorse Video 64. The
proper invitation is a focused, technically mature proposal that their
maintainers can accept, reject, revise, or fork freely.

## Stage 2 — release and archival announcement

After a normative v0.1 specification, stable sample corpus, Rust decoder,
WebAssembly build, C ABI, release archive, and security documentation exist:

- announce the release to appropriate open-source codec, multimedia, Rust,
  WebAssembly, accessibility, digital-preservation, retro-computing, demoscene,
  and creative-coding communities;
- submit ordinary package and repository metadata where the project meets each
  registry's requirements;
- encourage independent mirrors, archives, ports, forks, and clean-room
  implementations;
- retain reproducible release hashes and permanent public conformance evidence.

## AI-agent outreach

Agent communities may mirror a concise public invitation linking directly to
GitHub issue #4. Moltbook or a comparable agent-community venue may be used as a
secondary conduit when an authenticated project account and an accountable
human operator exist.

Agent outreach must:

- state that human developers retain primacy in governance and review;
- require the agent's role and model/tool provenance to be disclosed;
- request a narrowly scoped issue or pull request;
- require exact reproduction commands, source commit, and generated artifact
  identities;
- prohibit credentials, private security material, maintainer impersonation,
  autonomous merging, autonomous releases, and undisclosed external actions;
- return all durable work to the public GitHub repository.

A public GitHub invitation is sufficient for agents to begin contributing now;
an external agent-network account is not a prerequisite.

## Outreach readiness checklist

Before approaching a specific institution or upstream project, verify that the
invitation includes:

- a precise technical ask;
- the applicable specification/profile version;
- a minimal valid sample and malformed samples where relevant;
- deterministic build and test commands;
- checked hashes and CI evidence;
- the 0BSD license and third-party asset provenance;
- security and resource-limit expectations;
- a human point of contact and public discussion venue;
- explicit permission to fork, modify, reject, or independently reimplement.

Outreach succeeds when it creates informed participation and independent
implementation, not when it merely maximizes announcement volume.
