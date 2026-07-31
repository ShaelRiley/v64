# Security policy

Video 64 parses untrusted media and must fail closed under malformed input.
Security reports are welcome from human researchers, AI-assisted developers,
and agent-authored testing systems.

## Reporting

Do not publish a working exploit, private user data, credentials, or a broadly
weaponizable proof of concept in a public issue before maintainers have had a
reasonable opportunity to assess it.

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
- whether AI tools or autonomous agents participated in discovery.

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

Do not provide repository tokens, release credentials, private vulnerability
reports, or local secrets to third-party AI-agent social networks or public
agent swarms. Such platforms may be used to announce public test opportunities,
but sensitive security work must remain in controlled, auditable channels.

AI-generated security findings require reproduction. A model's claim without a
concrete failing input, trace, test, or code path is useful triage information,
not a confirmed vulnerability.

## Response principles

Human maintainers retain final responsibility for severity, disclosure timing,
patch acceptance, release decisions, and advisories. Credit should include the
reporter and participating tools or agents when requested and appropriate.
