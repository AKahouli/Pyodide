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
and normal editing remains available. This does not automatically opt
other repositories into Hindsight or create their policy files.
Policy routes identify the minimum documentation that must be consulted for
each edited area. Extend them for new owning contracts; retain the human index
at `docs/agent-context/README.md`.

## Advisory checkpoints and editing

The harness supplies `sdlc_checkpoint`, `sdlc_resume` and `sdlc_health`.
Save compact goal, criteria, progress, verification inputs and next action at
milestones. Checkpoints and integration health are advisory. Native OpenCode
permissions govern edits and shell commands; no reservation, preparation tool,
read receipt or task status is required to edit. Documentation and code reuse
remain workflow instructions. Graph/Hindsight failures use focused source and
Git documentation as the fallback. Checkpoint failures do not block coding.

## Background handoff and scoped recipes

Native Task handles asynchronous execution and completion notifications.
Prefer background maintainer tasks when the current Task schema supports them. If background execution is unavailable, the primary completes the exact scoped documentation directly using the existing handoff and evidence; a bounded foreground maintainer is also allowed when useful. Do not invent unsupported arguments, ask for authorization again, or leave documentation pending solely because background routing is unavailable.
The guard covers Task invocations, not direct manual agent selection.

Save child IDs, owned paths, source inputs and pending results in existing
checkpoint fields. Continue independent work, then return control when none remains.
The user can message while children run; integrate automatic completion without
polling or repeating discovery. Independent checkpoint history and private QA
isolation remain unchanged. Full completion still includes affected documentation.
Detailed recipes are loaded only when relevant from [WORKFLOW](docs/WORKFLOW.md).
The reusable `tests/live-background.mjs --create-fixture` prepares an isolated
headless acceptance run; see [setup](docs/DEVELOPER-SETUP.md). It checks interaction,
checkpoint retention, maintainer scheduling and automatic completion with the
installed plugin. Desktop UI behavior needs separate verification.

## Interruption, resume and parallel sessions

Task history lives locally in ignored `.opencode/sdlc/checkpoints.sqlite`.
SQLite transactions preserve independent session updates. File claims have been
retired and are cleared when the updated runtime opens an existing store.

Send `resume` to select one matching unfinished task, or `resume task TASK_ID`
to select explicitly. Multiple candidates need a selection. Resuming creates an
independent continuation with the saved goal and next action, preserving both the
source task and any existing destination task. It requires no cancellation,
fresh chat, dead-process check or transfer of editing rights. Changed verification
inputs make prior checks historical. Reconcile source and runtime before continuing.

Agents coordinate parallel edits through disjoint assignments and source review.
No file locks or ownership tool is involved. Private QA contexts and per-run
fixtures continue to follow the existing workflow.

## Verification

Focused checkpoint, startup and plugin tests cover independent concurrent
progress, resume history, historical checks and unrestricted native edits with
missing preparation or unavailable checkpoint storage.

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
