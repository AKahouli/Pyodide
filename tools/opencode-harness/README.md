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

Checkpoint/edit workflow activates in worktrees containing
`tools/opencode-harness/policy.json`. Startup diagnostics also run elsewhere:
missing policy/checkpoint support is reported rather than silently disabled,
and guarded native edits wait for recovery. This does not automatically opt
other repositories into Hindsight or create their policy files.
Policy routes identify the minimum documentation that must be consulted for
each edited area. Extend them for new owning contracts; retain the human index
at `docs/agent-context/README.md`.

## Task lifecycle and reuse gate

### Mandatory session startup checks

Each new session, including children and parallel OpenCode processes, receives
its own startup check in the active root. Checkpoint health is a real local
SQLite transaction write/read round trip. Graph connection and Hindsight API
health are checked with bounded requests through the existing services.
They remain `PENDING` until actual scoped graph statistics and
`hindsight_diagnose` results verify the graph root and the actual plugin's memory
workspace/bank. Hindsight also performs an authenticated bank read and checks
that automatic capture is configured. This verifies availability/configuration,
not the success of future asynchronous memory extraction or graph freshness.
Session-tagged asynchronous capture failures are checked in the bounded Hindsight
diagnostic tail during later health/turn checks; another session's failure cannot
invalidate this session. A background failure appearing after the final turn is
reported on the next check, rather than promised as an immediate callback.

The default graph MCP uses the core `code-review-graph` package. Optional vector
embeddings are not a startup dependency: Windows PyTorch DLL failures in the
embeddings environment must not disable structural graph navigation. Semantic
search may be unavailable; use structural queries and focused source search.

Use `sdlc_health` to read the actual statuses. The agent reports a short startup
line; child agents report to their caller. Failures include recovery actions in
system context, stderr and a UI toast when available. Source edits and mutating
Git/build commands are gated until all three checks pass. Read-only diagnosis and
checkpoint/blocker recording remain available. After recovery run
`sdlc_health(refresh: true)`, repeat the pending probes, and read health again.

Health receipts are isolated by canonical worktree, native session and process
owner. A restart/resume cannot borrow another session's healthy receipt; same-chat
task generations preserve the current session's verified startup. There is no
automatic daemon restart, opt-in expansion, graph rebuild or second graph MCP
process. A missing/unloadable plugin cannot diagnose itself: global instructions
require reporting a missing `sdlc_health` tool as a setup failure.

1. `sdlc_checkpoint`: save goal, 2-5 acceptance criteria, execution choice,
   decisions, completed work, blockers, pending task IDs, and exact next action.
2. Read the context index, short routed scoped instructions,
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
