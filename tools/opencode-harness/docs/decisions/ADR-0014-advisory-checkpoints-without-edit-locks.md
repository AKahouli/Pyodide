---
id: ADR-0014
status: accepted
scope: opencode-editing-and-recovery
source_paths:
  - tools/opencode-harness/runtime/lib/sdlc-core.mjs
  - tools/opencode-harness/runtime/plugins/sdlc.js
  - AGENTS.md
reviewed_at: 2026-10-14
---

# Advisory checkpoints without edit locks

## Decision

At the user's explicit request, remove file claims, mandatory read receipts,
preparation/release tools, checkpoint-status edit gates and checkpoint ownership
transfer restrictions. Native OpenCode permissions govern editing. Agents consult
relevant documentation and reuse code through normal workflow instructions.

Keep optional checkpoints, automatic context recall, integration health reporting
and resume. Resume creates an independent continuation instead of transferring
ownership, preserving source and destination histories. Ambiguous automatic resume
still asks which task is intended. Checkpoint failures are advisory.

Existing claim rows are cleared when the new runtime opens the local store.
Retain checkpoint history and legacy baseline data. Parallel sessions coordinate
overlapping files through task assignments, source checks and integration review.

## Rationale and consequences

Process lifetime and task lifetime differed, leaving stale claims that blocked
legitimate work. Explicit recovery paths still imposed workflow costs the user
rejected. Removing the claim mechanism makes editing independent of task metadata.
There is no harness protection against overlapping edits; teams must coordinate.

## Superseded decisions

Supersedes the edit ownership/read-receipt enforcement portions of ADR-0005,
ADR-0006, ADR-0009 and ADR-0011. Other instructions, including architecture approval,
documentation maintenance, private QA and background maintainers, remain applicable.

## Verification

Tests cover edits without preparation, overlapping sessions, missing policy,
independent concurrent checkpoint progress, resume history and stale check inputs.
Runtime review checks that checkpoint errors do not become native edit blockers.
