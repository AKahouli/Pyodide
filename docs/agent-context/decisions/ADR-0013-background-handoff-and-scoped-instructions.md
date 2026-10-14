---
id: ADR-0013
status: accepted
reviewed_at: 2026-10-13
scope: agent-delivery-and-instruction-loading
source_paths:
  - AGENTS.md
  - tools/opencode-harness/config/AGENTS.md
  - tools/opencode-harness/config/agents/maintainer.md
  - tools/opencode-harness/runtime/plugins/sdlc.js
  - tools/opencode-harness/docs/WORKFLOW.md
---

# Background handoff and scoped instructions

## Decision

Keep permanent instructions compact: authority, reuse, checkpoint/ownership,
asynchronous handoff, documentation and delivery rules. Load detailed workflow
recipes only when relevant. Keep checkpoint and parallel-session protections.

Use native background tasks for independent long work; the primary remains
available for user feedback, records child references in existing checkpoint
fields and integrates completion notifications. It must not poll or duplicate
children. Use bounded handoffs and reuse unchanged verification evidence.
Corrections retain the same child and agent role; changed roles use a new child.

**Maintainer always runs asynchronously**, including follow-ups on the same child:
every invocation requires native `Task(background: true)`. Enforce this narrow
requirement in the plugin. If unsupported, report pending documentation/recovery
and continue coding without foreground fallback. Documentation remains required
for full completion, in the same branch/PR, without delaying ready-to-test.

## Rationale and preserved constraints

The user explicitly approved background handoff and shorter instructions on
2026-10-13, and required maintainer invocations to be asynchronous. Bounded tasks
and smaller permanent context target response latency and repeated token use.
No measured token savings or desktop acceptance is claimed by this decision.

Retain WAL checkpoints, process ownership, exact file claims, private browser
contexts, source/read freshness, architecture approvals and branch documentation.
Graph/Hindsight failures remain advisory under [ADR-0011](ADR-0011-advisory-integrations-and-native-policy.md).
No schema, runtime or service is added; use existing `pending`/`nextAction` fields.
This refines the maintainer scheduling policy in ADR-0012 without editing its
accepted history. Operational details: [agent delivery](../architecture/agent-delivery.md).

## Verification and acceptance

Installed non-pure OpenCode CLI 1.18.34 with harness
`2026-10-13-background-handoff` passed [live acceptance](../../../tools/opencode-harness/tests/live-background.mjs)
using `--create-fixture`: foreground maintainer rejected, background accepted,
checkpoint/pending IDs survived idle and another turn. Parent response completed
5.9 seconds into the child's 35.6-second command; automatic completion resumed it.
Intentional graph/Hindsight failures remained advisory. This is not GUI acceptance.
Broader regressions: 45/46 passed, including checkpoint/WAL/ownership/plugin guards.
The remaining failure concerns five removed feature-document routes in the user's
pre-existing dirty policy, untouched by this task. Review found no critical/major
issues. Same-child maintainer follow-up rejected `background: false` and accepted
`background: true`. A worker label with the prior maintainer ID resolved to an
actual worker, not a foreground maintainer bypass. Required bounded review passed
with no remaining findings. Instructions shrank from 3,202 to about 1,425 words,
without measured token or latency savings. Primary acceptance follows the user's
explicit approval and the completed bounded review/native tests. Full desktop GUI
interaction remains unverified.
