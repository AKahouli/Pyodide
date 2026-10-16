---
id: ADR-0005
status: accepted
scope: task-recovery-and-edit-enforcement
source_paths:
  - AGENTS.md
  - tools/opencode-harness/policy.json
  - tools/opencode-harness/runtime/lib/sdlc-core.mjs
  - tools/opencode-harness/runtime/plugins/sdlc.js
reviewed_at: 2026-10-12
---

# Durable task checkpoints and reuse evidence before edits

## Decision

Version approved repository instructions and a credential-free OpenCode
configuration snapshot in Git. Install the native SDLC plugin and approved
agent instructions from `tools/opencode-harness/install.ps1`; preserve working
provider/authentication settings. Activate only worktrees containing the
versioned policy marker.

Maintain compact task checkpoints and local source baselines in an ignored,
per-worktree SQLite WAL store. Native session IDs and explicit task generations
separate parallel work. Transactions protect progress and file ownership across
processes. Save an in-flight checkpoint before native source edits and current
fingerprints afterward. Preserve intent, criteria, decisions, verification
inputs, pending task references, blockers, and next action at milestones.

Before native edits, require successful current reads of routed documentation,
the existing target, and a closest reuse candidate. Record the reuse decision
and exact target ownership through `sdlc_prepare`. If no candidate exists,
require prior search and the reason for new code. Reject stale evidence and
overlapping ownership. Direct shell source mutations are not an edit bypass;
approved inspection/test/build commands retain their existing permissions.

A clear resume request in a fresh session automatically selects one eligible
checkpoint in the exact worktree/branch. Ambiguous tasks require one selection;
ordinary requests never attach unrelated work. Transfer revokes the old
session's edit ownership and invalidates read/prepare receipts. Changed check
inputs or HEAD make passed results historical. Reconcile interrupted edits,
external changes, child availability, and private browser runtime before work.

Use task baseline diffs for review; do not attribute pre-existing or external
changes to the task. Unrelated later requests in the same chat allocate a new
task generation; same-task corrections can reopen existing work. Docs and
experience memory remain separate from operational checkpoints.

## Rationale

Prompts alone cannot ensure agents consult existing documentation/code or
recover interrupted work. Small native hooks provide observable evidence and
atomic recovery without another service, repeated whole-repo discovery, or
serial documentation/review gates.

## Verification and limits

Focused tests cover concurrent process writes, killed edits, ownership clashes,
ambiguous resume, stale checks, pre-existing changes, task generations, and
separate and linked Git worktrees, including packed branch references. Native
OpenCode integration passed with two concurrent servers: unprepared edits were
rejected, prepared edits succeeded, task state remained independent, and a fresh
session resumed saved work with the next action visible to the model. Effective
specialist tool permissions were also inspected.

Read receipts and a declared reuse decision do not prove semantic uniqueness.
Allowed project scripts are trusted code, not an OS sandbox. Check freshness
depends on the input files supplied; credential detection is heuristic. Keep
secrets/raw logs out of checkpoints and use local, non-synced SQLite storage.
The owning [harness guide](../../README.md) contains
installation, lifecycle, tools, recovery, and verification details.
