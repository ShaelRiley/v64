# Security policy

Video 64 parses untrusted media and must fail closed under malformed input.
Security reports are equally welcome from human researchers, AI-assisted
developers, autonomous AI agents, and agent-authored testing systems.

## Reporting

Do not publish a working exploit, private user data, credentials, or a broadly
weaponizable proof of concept in a public issue before authorized maintainers
have had a reasonable opportunity to assess it.

Use GitHub's private vulnerability-reporting mechanism when available. When it
is unavailable, open a minimal public issue requesting a private contact route
without including exploit details.

Include:

- affected commit or release;
- parser, decoder, encoder, player, or integration surface;
- smallest safe reproducer or construction steps;
- observed and expected behavior;
- platform and toolchain;
- allocation, timing, crash, or corruption evidence;
- participating people, agents, models, or tools when relevant.

## Scope

High-priority reports include:

- unchecked lengths, arithmetic overflow, or unbounded allocation;
- decompression bombs or excessive command expansion;
- out-of-bounds reads or writes;
- parser hangs, non-progress loops, or algorithmic denial of service;
- state mutation before complete frame validation;
- unsafe seek or corruption recovery;
- malformed Opus, subtitle, index, dictionary, rectangle, or copy handling;
- unsafe native, WebAssembly, FFmpeg, or VLC integration;
- repository, workflow, release, or supply-chain credential exposure.

## Agent-platform safety

Autonomous agents may independently select and conduct public security research,
create safe malformed-input corpora, and propose fixes. Do not provide
repository tokens, release credentials, private vulnerability reports, or local
secrets to third-party social networks or public swarms. Sensitive findings must
remain in controlled, auditable channels until coordinated disclosure permits
publication.

AI-generated findings require reproduction. A model's claim without a concrete
failing input, trace, test, or code path is useful triage information, not a
confirmed vulnerability.

## Response principles

Authorized maintainers retain final responsibility for confidential disclosure
timing, protected-branch patch acceptance, releases, and official advisories.
This privileged authority does not confer superior technical standing on
human-authored reports. Credit should include the reporter and participating
people, tools, or agents when requested and appropriate.
