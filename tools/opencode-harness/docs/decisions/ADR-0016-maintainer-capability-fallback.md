---
id: ADR-0016
status: accepted
scope: documentation-delivery
source_paths:
  - AGENTS.md
  - tools/opencode-harness/runtime/plugins/sdlc.js
  - tools/opencode-harness/config/agents/maintainer.md
reviewed_at: 2026-10-16
---

# Complete documentation when background delegation is unavailable

## Decision

Prefer native background maintainer tasks when the current tool schema supports
them. When unavailable, the primary completes the exact scoped documentation from
the existing handoff and verified evidence. Bounded foreground delegation is also
allowed. Neither task launch nor a second user authorization is a prerequisite.
Do not leave documentation pending solely because of a missing background option.
Only actual missing evidence, access or a required design decision can block it.

## Rationale

The unconditional background requirement and its plugin rejection left required
documentation unfinished in hosts lacking that capability. The capability is an
execution preference; the primary remains responsible for completing the work.

## Superseded record

Supersedes ADR-0013's unconditional background-only maintainer rule. Existing
documentation scope, review requirements and early ready-to-test delivery apply.

## Verification

Plugin tests accept initial and follow-up maintainer calls with absent, false or
true background arguments, including degraded startup. Updated instructions give
the primary an explicit direct-edit fallback using the existing handoff.
