# OpenCode SDLC harness

The versioned configuration snapshot, native plugin, and focused tests live
here. `config/opencode.example.json` uses environment references for credentials;
it is a reference, not an automatic replacement for working provider settings.
The existing Hindsight integration remains independent of task checkpoints.

## Install

Run `./tools/opencode-harness/install.ps1` from PowerShell, then restart OpenCode.
The installer copies the runtime and approved agent instructions into the user
configuration. It preserves `opencode.json`, authentication, and provider keys.
The installed plugin SDK must already exist in that configuration directory.
This implementation is verified against OpenCode 1.18.34.

The plugin activates only in worktrees containing
`tools/opencode-harness/policy.json`; other repositories are unaffected.
Policy routes identify the minimum documentation that must be consulted for
each edited area. Extend them for new owning contracts; retain the human index
at `docs/agent-context/README.md`.

## Task lifecycle and reuse gate

1. `sdlc_checkpoint`: save goal, 2-5 acceptance criteria, execution choice,
   decisions, completed work, blockers, pending task IDs, and exact next action.
2. Read current relevant sections of the context index, routed guidelines,
   existing targets, and the closest existing implementation/record. Successful
   native `Read` calls establish hash-bound receipts; shell reads do not.
3. `sdlc_prepare`: name exact owned targets, documents, sources, and a reuse
   decision. If no candidate exists, search first and explain why new code is
   needed. The tool reserves files transactionally; another task cannot claim
   them. A stale source/document/target requires fresh evidence and preparation.
4. Use native `Edit`, `Write`, or `ApplyPatch`. The hook saves an in-flight
   checkpoint before the edit and current fingerprints afterward. Each target's
   original local content is preserved for task-only review, including changes
   already present before the task started.
5. Save meaningful progress and check inputs at milestones and before replying.
   `ready` releases edit claims while awaiting user testing/required review;
   `completed` ends the task. Reopen same-task feedback with `status: active`.
   For a genuinely unrelated request in the same chat, set `newTask: true`;
   this allocates a separate checkpoint and baselines while preserving old work.

The reviewer can call `sdlc_diff(file, taskID)` using the primary task ID supplied
in its handoff. It excludes pre-existing changes. External changes after the
task baseline produce an explicit review gap instead of a falsely scoped diff.

## Interruption and automatic resume

Checkpoints, read receipts, file claims, and compressed local baselines are
stored in `.opencode/sdlc/checkpoints.sqlite` under the canonical worktree root.
SQLite WAL transactions make updates atomic across processes. The directory is
ignored by Git; it must be on a local filesystem and must not be a symlink to
another worktree's storage. Baselines are local recovery data, not approved
documentation or deliberate Hindsight uploads.

On a new session, send **resume** or **continue the previous task**. One eligible
unfinished checkpoint is transferred automatically. Several candidates produce
one selection request, never a guessed task. **resume task TASK_ID** or
`sdlc_resume(taskID)` selects explicitly. Ordinary new requests never attach an
unrelated checkpoint. An active old process must interrupt/park its task before
transfer; dead processes can be recovered. The old session loses edit ownership.
Starting a new session does not itself start execution without a user request.

Recovery clears prior read receipts and prepared edit permissions. Previously
passed checks are historical if HEAD or recorded input fingerprints changed.
An interrupted edit and external source changes are explicit reconciliation
items. Verify pending specialist availability and browser/application runtime;
do not blindly relaunch tasks or copy private browser authentication state.
The checkpoint is injected into model context and compaction automatically.

## Parallel sessions

Native session IDs/task generations separate task state. File claims use
canonical paths, including case folding on Windows and symlink resolution.
Disjoint targets can progress concurrently in one worktree. Overlapping source
work needs coordination or separate Git worktrees. Different worktrees have
independent stores and receive committed documentation/instructions.
Private Chrome contexts and per-run Playwright fixtures remain separate.

## Enforcement limits

The gate verifies documentation/source evidence and a declared reuse decision;
it cannot prove semantic uniqueness or that every relevant contract was chosen.
Tests, self-review, and risk-based independent review remain necessary.

Direct shell source mutation, command chains, redirection, and arbitrary scripts
are denied. Simple Git inspection/staging/commit and established test/build/dev
commands are allowed; existing OpenCode permissions still apply. Allowed scripts
are trusted project code, not an OS sandbox. Browser evidence file outputs must
stay under `qa-artifacts/`. Other external tools retain their own permissions.

Checkpoint credential detection is heuristic: never submit passwords, tokens,
cookies, or raw logs. Save non-secret references only. Check freshness covers
the files explicitly supplied as inputs; include relevant contracts/config/tests.
Review proposals before treating documentation as approved policy.

## Verification

`node --test tools/opencode-harness/tests/harness.test.mjs` checks evidence gates,
concurrent process writes, killed-edit recovery, ambiguous resume, stale checks,
pre-existing dirty changes, native patch targets, shell mutation rejection,
task generations, and worktree isolation. Live OpenCode checks additionally
exercise the native plugin hooks, specialist tool permissions, and resume context.
