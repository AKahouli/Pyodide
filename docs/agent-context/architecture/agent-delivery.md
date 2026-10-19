# Agent delivery and asynchronous documentation

Scope: OpenCode SDLC harness. Evidence inspected on 2026-10-13 in branch
`baseline/semantic-model-001`; policy is recorded in ADR-0013, with the capability fallback updated by ADR-0016.

## Execution and handoff

- `build` owns integration, user interaction and the earliest verified testable flow.
  Small fixes stay with the primary; useful independent long work uses native
  `Task(background: true)` with bounded criteria and disjoint owned paths.
- Prefer background maintainer tasks when the current Task schema supports them. If background execution is unavailable, the primary completes the exact scoped documentation directly using the existing handoff and evidence; a bounded foreground maintainer is also allowed when useful. Do not invent unsupported arguments, ask for authorization again, or leave documentation pending solely because background routing is unavailable.
- Supply absolute worktree root/branch, checkpoint ID, exact owned docs, stable
  source revision or task-scoped diff, changed behavior/rationale, existing checks,
  required review state and confirmed architecture approval when applicable.
  Reuse supplied evidence rather than repeating discovery or checks.
- Save child/task ID, purpose, owned paths, input revision and pending result in
  existing checkpoint `pending`/`nextAction` fields. Continue independent work.
  When none remains, return control so the user can message while children run.
  Completion notifications resume integration; do not poll, sleep or relaunch.
- Corrections reuse the same child with the same agent role; a changed task role
  needs its own child, rather than relabeling an existing task.
- User corrections steer the active task and retain unfinished children. Reconcile
  their source inputs before integrating; changed inputs make evidence stale.

## Protection and delivery

- Keep per-worktree SQLite WAL checkpoints, process/session ownership, read
  evidence, exact file claims and interrupted-edit recovery. No new checkpoint
  schema or service is introduced for child references.
- Workers own disjoint files; the primary coordinates shared contracts and indexes.
  Keep private browser contexts/page IDs, test data, reports and cleanup separate.
  Respect existing ports/processes and unrelated dirty or staged files.
- Graph/Hindsight errors remain advisory; use source/tests and Git docs/checkpoints.
  Storage, ownership and stale/unprepared edit failures retain their native guards.
- Preview is unvalidated. Ready-to-test requires focused checks and frontend QA;
  report the exact route/action/result. Required review may remain pending for
  local testing. Full completion includes review and affected documentation.
- Maintainer updates feature behavior, architecture and contracts in the same
  implementation branch/PR; it does not delay the first validated testable result.
  The primary owns instructions/module READMEs outside `docs/agent-context/`.
  Preserve accepted ADRs; changed durable decisions use a new proposed record.

## Installation and shared-host safety

[One-click setup](../../../tools/opencode-harness/docs/DEVELOPER-SETUP.md#one-click-installer)
uses the existing harness installer, per-user SID mutex, active-host guard and
timestamped backups. It preserves JSONC provider/auth settings and permission order;
it never stops an active OpenCode host. Graph readiness is checked. Optional
Hindsight reuses configured setup; choosing N skips installation without disabling
existing memory. Exit 0 means success, 1 core failure, 2 pending integrations.
No runtime/checkpoint code changes accompany this operational automation.
Thirteen isolated [setup tests](../../../tools/opencode-harness/tests/setup.test.mjs)
passed with mocked installers and real temporary config; bounded review passed.
Clean-machine installation, WSL/UAC and new-provider sign-in remain unverified.

## Source and verification

Policy lives in [root instructions](../../../AGENTS.md),
[global instructions](../../../tools/opencode-harness/config/AGENTS.md) and
[maintainer instructions](../../../tools/opencode-harness/config/agents/maintainer.md).
The asynchronous maintainer guard is in
[the native plugin](../../../tools/opencode-harness/runtime/plugins/sdlc.js).
Detailed recipes are loaded from [workflow](../../../tools/opencode-harness/docs/WORKFLOW.md).

Installed native CLI 1.18.34 with harness `2026-10-13-background-handoff` passed
[live acceptance](../../../tools/opencode-harness/tests/live-background.mjs)
using `--create-fixture`: foreground maintainer rejected, background accepted,
checkpoint/pending IDs preserved through idle and the next turn. Parent response
completed 5.9 seconds into the child's 35.6-second command; completion notification
resumed the parent. Intentional graph/Hindsight failures did not block the test.
This is non-pure CLI evidence, not desktop GUI acceptance. Of 46 broader tests,
45 passed; the existing dirty policy's removal of five feature-document routes
causes the remaining failure. This task leaves that unrelated policy unchanged.
Checkpoint/WAL/ownership/plugin guard tests passed; review found no critical/major
issues. Follow-up on the same maintainer `task_id` rejected `background: false`
and accepted `background: true`. Supplying a worker label with that maintainer ID
resolved to an actual worker agent, not a foreground maintainer bypass. Required
bounded review passed with no remaining findings; primary accepted ADR-0013.
Permanent instructions fell from 3,202 to about 1,425 words; token/time savings
are unmeasured.
