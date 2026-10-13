# OpenCode SDLC harness

The versioned configuration snapshot, native plugin, and focused tests live
here. `config/opencode.example.json` uses environment references for credentials;
it is a reference, not an automatic replacement for working provider settings.
The existing Hindsight integration remains independent of task checkpoints.

For developer onboarding and manual steps, start with
[Developer setup](docs/DEVELOPER-SETUP.md), then
[Hindsight setup](docs/HINDSIGHT-SETUP.md) and
[Operations/recovery](docs/OPERATIONS.md). `package.ps1` exports committed source
and the reviewed repository context profile with a manifest and hashes.

## Install

Run `./tools/opencode-harness/install.ps1` from PowerShell, then stop and restart
the entire OpenCode host process. Creating a new chat in a running host does not
reload plugins. Startup output and `sdlc_health` expose the loaded runtime version;
use it to identify hosts still running an older installed plugin.
The installer copies the runtime and approved agent instructions into the user
configuration. It preserves `opencode.json`, authentication, and provider keys.
Existing owned runtime/agent/skill/instruction files are backed up under the
destination's `.sdlc-backups/` before replacement. Reconcile personal instruction
or model overrides from that backup after installation.
The installed plugin SDK must already exist in that configuration directory.
Native parallel-session checks are verified against OpenCode CLI 1.18.34;
the graph driver is also verified in the desktop's Node 24.15 runtime.

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
automatic native checks in the active root. Checkpoint health is a real local
SQLite transaction write/read round trip with a session-specific receipt. Graph
health checks the connected host MCP and reads the current root's index without
rebuilding it. Hindsight resolves the host configuration, worktree mapping and
bank before overrides, then checks API readiness, authenticated bank access and
enabled automatic capture. It does not construct another Hindsight plugin.
Host API requests use the actual launch directory. Graph ownership and memory
configuration use the owning worktree, matching the installed Hindsight adapter;
launching from a frontend subdirectory must not create a second root instance or
select a different memory bank. Runtime selection uses `process.versions.bun`,
not a compatibility global. Read-only graph queries tolerate brief writer locks.
Concurrent first-time checkpoint initialization retries only SQLite busy/locked
errors within a five-second lock budget; permanent errors remain explicit.

The native startup result is injected into context. No model-driven graph
statistics, `hindsight_diagnose` or `sdlc_health` round trips are required to
complete startup. Task-specific graph context and freshness checks still apply
when investigating code. Availability does not establish complete graph coverage,
working-tree freshness or future asynchronous memory extraction success.
Session-tagged asynchronous capture failures are checked in the bounded Hindsight
diagnostic tail during later health/turn checks; another session's failure cannot
invalidate this session. A background failure appearing after the final turn is
reported on the next check, rather than promised as an immediate callback.

The default graph MCP uses the core `code-review-graph` package. Optional vector
embeddings are not a startup dependency: Windows PyTorch DLL failures in the
embeddings environment must not disable structural graph navigation. Semantic
search may be unavailable; use structural queries and focused source search.

Use the injected native results; `sdlc_health` is optional for inspection and
recovery. The agent reports failures; child agents report them to their caller.
Failures include recovery actions in
system context, stderr and a UI toast when available. Source edits and mutating
Git/build commands are gated until all three checks pass. Focused tests, lint,
type checks and the established observability diagnostics remain available even
when graph/memory health fails, so the agent can reproduce defects and recover.
Shell metacharacter/output/eval guards still apply; these trusted scripts are not
an OS sandbox. Read-only diagnosis and
checkpoint/blocker recording remain available. After recovery run
`sdlc_health(refresh: true)` to rerun native checks. Do not repeat model tool probes.

Health receipts are isolated by canonical worktree, native session and process
owner. Concurrent in-flight service probes coalesce only within one process and
canonical root; completed results are not a persistent cross-session cache.
Each session writes its own checkpoint receipt, and independent OpenCode processes
perform their own probes. A restart/resume cannot borrow another session's healthy
receipt; same-chat task generations preserve the current session's verified startup.
There is no
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
