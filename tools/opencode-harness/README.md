# OpenCode SDLC harness

The versioned configuration snapshot, native plugin, and focused tests live
here. `config/opencode.example.json` supplies integration and permission defaults;
merge it with working provider settings rather than replacing them.
The existing Hindsight integration remains independent of task checkpoints.

For developer onboarding and manual steps, start with
[Developer user guide](docs/DEVELOPER-SETUP.md), then
[Hindsight setup](docs/HINDSIGHT-SETUP.md) and
[Operations/recovery](docs/OPERATIONS.md). `package.ps1` exports committed source
and the reviewed repository context profile with a manifest and hashes.

## Install

For guided Windows installation, double-click [Install-Harness.cmd](Install-Harness.cmd).
It asks whether to install Hindsight (Y/N), reuses `install.ps1` and preserves personal
configuration with backups. See [the one-click procedure](docs/DEVELOPER-SETUP.md#one-click-installer)
for prerequisites, authentication/WSL steps and partial-success exit codes.

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
system context, stderr and a UI toast when available. Graph/Hindsight failures or
pending checks are advisory: continue coding with focused source/tests and Git
docs/checkpoints. Native edit tools still require durable checkpoint intent, current
read evidence and transactional ownership; actual storage/ownership failures block
them. Shell execution uses native OpenCode permissions, independent of integration
health or checkpoint availability.
Authorized runtime startup, log collection, tests and builds can continue during
recovery. Restricted specialists return runtime/access needs to `build` rather
than bypass their native permissions. Investigation and
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

## Background handoff and scoped recipes

Native Task handles asynchronous execution and completion notifications.
Every maintainer initial/follow-up invocation requires `background:true`; the
plugin rejects foreground maintainer Task calls in healthy and degraded modes.
Unsupported background support leaves docs pending while coding continues.
The guard covers Task invocations, not direct manual agent selection.

Save child IDs, owned paths, source inputs and pending results in existing
checkpoint fields. Continue independent work, then return control when none remains.
The user can message while children run; integrate automatic completion without
polling or repeating discovery. Checkpoint ownership, edit guards and private QA
isolation remain unchanged. Full completion still includes affected documentation.
Detailed recipes are loaded only when relevant from [WORKFLOW](docs/WORKFLOW.md).
The reusable `tests/live-background.mjs --create-fixture` prepares an isolated
headless acceptance run; see [setup](docs/DEVELOPER-SETUP.md). It checks interaction,
checkpoint retention, maintainer scheduling and automatic completion with the
installed plugin. Desktop UI behavior needs separate verification.

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
After completing or cancelling the current task, `sdlc_resume(taskID)` can transfer
another task within the same session. The finished checkpoint remains available
for review. To keep the current goal and release only a dead process's stale file
claim, use `sdlc_release(taskID, files)` with exact paths. It refuses live owners
and interrupted edits, preserves the old checkpoint with a review gap, and still
requires current Read evidence plus `sdlc_prepare` before editing.
If the current task was cancelled, start a new task checkpoint for the intended
goal before preparing edits; releasing a stale claim does not reopen it.
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

The plugin does not parse or whitelist shell commands. Command permissions belong
to native `opencode.json` and agent Markdown frontmatter. Agents must use guarded
native edit tools for authored source/document changes; shell/script writes can
bypass read receipts and file claims, so this is not an OS sandbox. In parallel
sessions, runtime commands must respect existing resource ownership and avoid
shared resets. Browser evidence file outputs must
stay under `qa-artifacts/`. Other external tools retain their own permissions.

Checkpoint credential detection is heuristic: never submit passwords, tokens,
cookies, or raw logs. Save non-secret references only. Check freshness covers
the files explicitly supplied as inputs; include relevant contracts/config/tests.
Review proposals before treating documentation as approved policy.

## Verification

`node --test tools/opencode-harness/tests/harness.test.mjs` checks evidence gates,
concurrent process writes, killed-edit recovery, ambiguous resume, stale checks,
pre-existing dirty changes, native patch targets,
task generations, and worktree isolation. Live OpenCode checks additionally
exercise the native plugin hooks, specialist tool permissions, and resume context.
`tests/startup-plugin.test.mjs` verifies that runtime/log commands reach native
permission handling during graph failure or missing checkpoint policy. It verifies
that prepared coding works with graph and memory unavailable, while overlapping
file ownership and missing checkpoint policy still block native edits.
See [ADR-0010](../../docs/agent-context/decisions/ADR-0010-native-shell-permissions.md)
and [ADR-0011](../../docs/agent-context/decisions/ADR-0011-advisory-integrations-and-native-policy.md).

## Native policy and clear follow-up

Workflow and response instructions live in `AGENTS.md` and native agent Markdown;
command and specialist permissions live in `opencode.json`/agent frontmatter.
Keep broad permission defaults before specific exceptions: native rules use the
last matching rule. The plugin injects compact task state and health observations,
rather than another copy of the workflow prompt. Successful diagnostic tools do
not trigger duplicate graph validation or authenticated memory reads. Native tool
errors and session capture failures remain visible; explicit health refresh checks
recovery without gating coding.

Each human-facing response ends with **Follow-up:** an explicit next actor/action
and expected result. Ready-to-test work includes a concrete route/action/check;
proposals must not imply implementation. Ongoing authorized work continues without
routine confirmation. Reusable lessons are optional when useful, not a substitute
for the next step. Hindsight persistence is separate from the footer.

## Feature context and maintenance

Use `docs/agent-context/features/README.md` to locate only the affected feature.
Repository policy requires current feature-page reads before conversation and
semantic-model edits, in addition to scoped instructions and source evidence.
Keep these pages aligned with their branch; verify code/tests rather than treating
another branch's unmerged documentation as approved behavior.

`build` assigns affected feature/architecture/contract pages to `maintainer` after
source stabilizes, with exact documentation ownership and verification evidence.
Ready-to-test may precede that background work, but full completion requires reviewed
updates or a specific no-impact reason. Documentation ships in the implementation's
branch/PR; checkpoints preserve pending maintainer work through interruption.
See [documentation workflow](../../docs/agent-context/documentation-workflow.md).
