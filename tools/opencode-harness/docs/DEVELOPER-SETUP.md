# Developer user guide: OpenCode SDLC harness

Install the harness in your own account, launch OpenCode from the intended Git
checkout, then use `build` for implementation and fixes. The harness preserves
task checkpoints, coordinates parallel edits and routes agents to reusable code
and Git documentation. Independent work runs in the background so you can keep
messaging the main agent.

This guide covers the verified **Windows + PowerShell** setup. Hindsight runs
inside WSL/Ubuntu; OpenCode, Chrome and the code graph run on Windows.
macOS/Linux installation is not verified by this Windows procedure.

## Choose your starting point

| You need to… | Start here |
| --- | --- |
| Install with a guided double-click launcher | [One-click installer](#one-click-installer) |
| Install on a new developer machine | [First-time installation](#first-time-installation) |
| Check an existing installation | [Verify onboarding](#verify-onboarding) |
| Implement or fix something | [Daily use](#daily-use) |
| Continue interrupted work | [Resume a task](#resume-a-task) |
| Run parallel sessions or branches | [Parallel work](#parallel-work) |
| Fix setup problems or upgrade | [Recovery and upgrades](#recovery-and-upgrades) |

## What is shared and what stays local

| Layer | Location | Shared through Git? |
| --- | --- | --- |
| Harness source, installer, examples and tests | `<repo>/tools/opencode-harness/` | Yes |
| Team instructions and reviewed context | Root/scoped `AGENTS.md`, `docs/agent-context/`, owning READMEs/contracts | Yes |
| Installed runtime, agents and skills | `%USERPROFILE%\.config\opencode\` | No |
| Provider settings and sign-in | Your OpenCode configuration/account | No |
| Experience memory | Your WSL Hindsight daemon; Windows client config in `%USERPROFILE%\.hindsight\coding-agent.json` | No |
| Task checkpoints and local baselines | `<worktree>/.opencode/sdlc/` | No |
| Structural graph | `<worktree>/.code-review-graph/` | No |
| Private browser state and QA evidence | Task-owned Chrome context; `qa-artifacts/<task-id>/<run-id>/` | No |

Each developer uses their own credentials and memory. Reviewed documentation
travels with implementation in the same branch and PR.

## One-click installer

Finish/checkpoint active work and close OpenCode hosts, then double-click
[`Install-Harness.cmd`](../Install-Harness.cmd) in `tools/opencode-harness/`.
Run it from a reviewed checkout/release; the launcher uses a process-only execution
policy, subject to your organization's restrictions. It keeps the window open so
you can read the result. Internet access is needed for missing dependencies.

The first question is **Install Hindsight local experience memory? (Y/N)**:

| Answer | Result |
| --- | --- |
| **Y** | Installs the native Hindsight client, enrolls this repo, preserves existing endpoint/auth settings, and attempts local WSL setup if the configured local API is unavailable |
| **N** | Skips Hindsight setup; existing memory installations/settings remain unchanged. An unconfigured memory warning is advisory |

The script checks Git, Node 24+ and uv/uvx, installs missing prerequisites through
WinGet, installs the pinned SDK and OpenCode if absent, merges missing config
defaults, installs the harness, enables background tasks, and prepares Chrome/graph.
It backs up existing personal settings, preserves JSON/JSONC/provider configuration
and serializes installers per Windows user. It never stops an active OpenCode host.
An existing Node older than 24 needs an upgrade before rerunning.

Hindsight **Y** reuses a reachable configured service. A fresh local setup may need
Windows permission/restart for WSL, Ubuntu first-run initialization and an interactive
masked provider configuration. Existing WSL provider profiles are reused.
It does not copy anyone's credentials or silently create a new sign-in.
API/bank readiness is checked; extraction/capture still needs onboarding verification.

For explicit command-line choices, from the repository root:

```powershell
.\tools\opencode-harness\setup.ps1 -InstallHindsight N
# Or, when local experience memory is wanted:
.\tools\opencode-harness\setup.ps1 -InstallHindsight Y
# A separately extracted release can target an already prepared checkout:
.\tools\opencode-harness\setup.ps1 -RepoRoot 'C:\work\YellowStorm-poc' -InstallHindsight Y
```

If the release is outside a Git checkout, the launcher asks for the application's
root. That checkout must already contain the policy and its routed docs; merge the
release profile first. Setup does not overwrite team code/policy or clone a repository.

| Exit code | Meaning |
| --- | --- |
| 0 | Setup stages completed; restart, select accessible models and verify onboarding |
| 1 | Core setup failed; fix the displayed error before retrying |
| 2 | Harness installed, with Chrome/graph/Hindsight steps pending; follow the displayed recovery instructions |

After completion, continue at [Verify onboarding](#verify-onboarding).
For managed/manual installation, use the steps below.

## First-time installation

### 1. Install prerequisites and choose the checkout

Install Git, Node **24 or newer with `node:sqlite`**, Windows uv/uvx and Chrome
Stable. Install WSL/Ubuntu for local Hindsight. If WSL is missing, run this in an
administrator PowerShell terminal, restart if prompted, and complete Ubuntu setup:

```powershell
wsl --install -d Ubuntu-22.04
```

The tested dependency baseline is pinned below; these are not claims about the
latest releases. Upgrade deliberately and repeat onboarding checks.

| Component | Tested version |
| --- | --- |
| OpenCode CLI | 1.18.34 |
| OpenCode plugin SDK | `@opencode-ai/plugin@1.1.42` |
| One-click JSON/JSONC configuration helper | `jsonc-parser@3.3.1` |
| Code graph, core package | `code-review-graph==2.3.9` |
| Chrome MCP | `chrome-devtools-mcp@1.10.1` |
| Hindsight Coding Agents plugin | `@vectorize-io/hindsight-coding-agents@0.8.1` |
| Hindsight local service | `hindsight-embed==0.10.3` |

Use a normal developer PowerShell terminal for the remaining Windows commands:

```powershell
npm install -g opencode-ai@1.18.34
node --version
git --version
uvx --version
opencode --version
wsl --list --verbose

$repoRoot = 'C:\work\YellowStorm-poc' # Replace with YOUR Git checkout.
$configDir = Join-Path $env:USERPROFILE '.config\opencode'
Set-Location -LiteralPath $repoRoot
git rev-parse --show-toplevel
```

Clone/check out the team's agreed repository branch before this step. Prefer its
reviewed harness source. If you received a release ZIP, follow
[the release notes below](#using-a-release-zip); it does not include application code.

The checkout needs `tools/opencode-harness/policy.json`,
`docs/agent-context/README.md` and every document routed by that policy.
Check the actual policy rather than assuming another branch has identical routes:

```powershell
$policyPath = Join-Path $repoRoot 'tools\opencode-harness\policy.json'
$harnessPolicy = Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json
$contextPaths = @($harnessPolicy.documentationIndex) +
    @($harnessPolicy.documentationRoutes | ForEach-Object { $_.document })
foreach ($contextPath in ($contextPaths | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $contextPath) -PathType Leaf)) {
        throw "Missing routed document: $contextPath"
    }
}
```

Keep local checkpoints, graphs and QA evidence ignored by Git. Preserve the team's
existing ignore rules; do not ignore shared agents/configuration you intend to track.
For another application, adapt [the generic policy](../config/policy.generic.example.json)
and its instructions/docs; do not import YellowStorm architecture claims.

### 2. Install the runtime and merge configuration

Back up personal OpenCode configuration before configuring integrations.
From the Git root:

```powershell
npm install --prefix "$configDir" --save-exact @opencode-ai/plugin@1.1.42
.\tools\opencode-harness\install.ps1
```

If script execution is blocked, use your organization's approved signing/policy
procedure. Where permitted, the process-only alternative is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\opencode-harness\install.ps1
```

The installer copies runtime files, global instructions, seven specialists and
three skills. Existing owned files are backed up under
`$configDir\.sdlc-backups/<timestamp-id>`.
It **does not merge your personal instructions** or install/configure the services.
It preserves `opencode.json`, provider credentials and repository policy.
Reconcile personal instruction/model overrides from the backup after installation.

Merge [opencode.example.json](../config/opencode.example.json) into the active
`opencode.json` or `opencode.jsonc` under your configuration directory.
Preserve provider settings and any existing Hindsight plugin registration.
Do not create a competing config file or blindly replace the existing one.

The template configures graph MCP, Chrome MCP with `--isolated --page-id-routing`,
Context7, specialist permissions, subagent depth and context compaction/pruning.
The SDLC plugin is discovered from `plugins/sdlc.js`; do not also register it in
the `plugin` array. Hindsight uses its native plugin, not a second MCP server.

Connect your provider through `/connect` and select an available model through
`/models`. Review specialist files in `$configDir\agents`:

| Specialist | Shipped model / purpose |
| --- | --- |
| `explore` | `openai/gpt-6-luna`; bounded source investigation |
| `plan` | `openai/gpt-6.1-sol`; unresolved design |
| `worker` | Inherits primary model; independent owned implementation |
| `diagnostics` | `openai/gpt-6.1-sol`; focused diagnostic checks |
| `frontend-qa` | `openai/gpt-6.1-sol`; private browser validation |
| `reviewer` | `openai/gpt-6.1-sol`; required high-risk review |
| `maintainer` | `openai/gpt-6-luna`; asynchronous documentation updates |

If a model is unavailable, remove its `model:` override to inherit the primary,
or choose a model your provider actually offers. Reasoning settings must also
be supported. Reapply personal overrides after harness upgrades.

Enable native background tasks for this terminal and future user processes:

```powershell
$env:OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = '1'
[Environment]::SetEnvironmentVariable('OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS', '1', 'User')
```

Launch the CLI from this terminal initially. A desktop launcher must inherit the
new environment; fully restart it, or sign out/in if needed. Subagent depth alone
does not enable background execution.

### 3. Connect Hindsight and prepare the graph

Follow [Hindsight setup](HINDSIGHT-SETUP.md) for WSL installation, approved
provider authentication, daemon startup, Windows plugin installation, repository
opt-in and creation of the exact memory bank. Use your own authentication;
never copy another developer's credentials. Existing approved authentication
does not require another sign-in solely to install this harness.

Then verify the service from Windows:

```powershell
Invoke-RestMethod http://127.0.0.1:9077/health -TimeoutSec 10
```

Expected: healthy API and connected database. This alone does not prove memory
extraction or automatic capture; finish that guide's write/read and capture checks.

Prepare the graph once per checkout/worktree:

```powershell
uvx --from code-review-graph==2.3.9 code-review-graph build --repo "$repoRoot"
uvx --from code-review-graph==2.3.9 code-review-graph status --repo "$repoRoot" --json
uvx --from code-review-graph==2.3.9 code-review-graph daemon add "$repoRoot" --alias YellowStorm-poc
uvx --from code-review-graph==2.3.9 code-review-graph daemon status
```

Use a unique alias for another checkout/worktree. Expect a nonempty completed
index. Keep its default `.code-review-graph/graph.db` location; this health
check does not support an external graph data directory. Embeddings/PyTorch
are not prerequisites.

If no shared graph watcher is running, start one hidden Windows process:

```powershell
$uvxPath = (Get-Command uvx.exe).Source
Start-Process -FilePath $uvxPath -WindowStyle Hidden -ArgumentList @(
    '--from', 'code-review-graph==2.3.9',
    'code-review-graph', 'daemon', 'start', '--foreground'
)
uvx --from code-review-graph==2.3.9 code-review-graph daemon status
```

One watcher and one Hindsight daemon serve this developer's parallel sessions.
Register each worktree with the watcher; each retains its own graph.
For subsequent changes, use incremental `update --repo "$repoRoot"` when needed,
not routine full rebuilds. Watcher liveness and matching HEAD do not prove
uncommitted source freshness. Logon automation is optional; see
[operations](OPERATIONS.md) and [Hindsight startup](HINDSIGHT-SETUP.md).

## Verify onboarding

After active tasks are checkpointed/finished, fully close OpenCode hosts and launch
from the intended checkout. A new chat inside an old host does not reload plugins.

```powershell
Set-Location -LiteralPath $repoRoot
opencode
```

Send this prompt to `build`:

```text
Verify onboarding without source edits. Report the automatic startup statuses
for graph, Hindsight and checkpoints, the actual repository root and loaded
harness version. Reuse native results; do not repeat passing diagnostic calls.
For any failure, give the specific recovery action and say whether coding can
continue.
```

Expected runtime for this guide: `2026-10-13-background-handoff`.
The SDLC tools are `sdlc_checkpoint`, `sdlc_prepare`, `sdlc_resume`,
`sdlc_diff` and `sdlc_health`.

| Startup result | Expected action |
| --- | --- |
| All PASS | Start work; no repeated diagnostics |
| Graph/Hindsight FAIL or pending | Report the problem; continue with source/tests and Git docs/checkpoints |
| Checkpoint storage/ownership FAIL | Investigate and repair before native edits |
| Missing tools or old runtime | Repair installation and fully restart the host |

After recovery, request `sdlc_health(refresh: true)`. Health proves availability,
not complete graph coverage, future memory capture or application readiness.

For automated regression checks, from the Git root:

```powershell
node --test tools/opencode-harness/tests/*.test.mjs
```

Use the runner's actual result; no fixed test count is an installation guarantee.
Tests use disposable repositories/mocked integrations. They do not validate your
provider sign-in or application. Report failed tests with the failing policy/path;
do not remove guards to obtain a green result.

For the reusable native background acceptance test:

```powershell
node tools/opencode-harness/tests/live-background.mjs --create-fixture
```

Follow its printed two-terminal instructions. It uses an owned localhost server
and your accessible test model; the shipped probe selects `openai/gpt-6-luna`.
It verifies a second parent response during child execution, persistent child
references, automatic completion and initial/resumed maintainer background rules.
Stop only the test server you launched; never stop another session's host.
The verified CLI result does not establish desktop GUI behavior.

In your desktop session, request one bounded background task, then send another
message while it runs. Expect the main agent to answer and later report completion.
Maintainer calls must always use background mode, including follow-ups; unsupported
execution leaves docs pending with recovery instructions, not a foreground fallback.

For advanced two-process startup verification, use
[the parallel readiness procedure](PARALLEL-VERIFICATION.md).

## Daily use

Start services if stopped, then launch OpenCode from your actual checkout and use
`build`. The harness does not install application dependencies, provision test
accounts or start the application automatically; follow the owning runtime README.

### Implement a feature

```text
Implement [goal] in [area]. Requirements: [2–5 observable criteria].
Finish end to end. Reuse existing code and relevant Git documentation.
Deliver the first complete testable flow as soon as focused checks and frontend
QA pass. Run independent long work in the background; keep me able to message.
Update affected docs through the background maintainer in this branch.
```

### Fix a defect

```text
Fix [symptom]. Reproduction: [route, actions, expected and actual result].
Finish end to end. Add the smallest meaningful regression when feasible,
rerun affected checks, and tell me where/how to verify the fix.
```

The agent should inspect relevant docs/source, checkpoint intent and reserve owned
targets before editing. It asks only for consequential missing information.
A new schema/table/collection, module/service/runtime or microservice still needs
approval for the named design; general end-to-end authorization is insufficient.
For substantial phases you may instead choose: “Pause after each completed,
testable phase.”

### Understand delivery status

| Status | Meaning |
| --- | --- |
| Preview available | Something visible exists; validation is pending |
| Ready to test | Relevant focused checks and frontend QA passed; includes route/action/result |
| Ready for local testing; review pending | Testable, but required high-risk review is unfinished |
| Complete | Required checks/review and affected documentation finished, or specific no-impact reason |
| BLOCKED | Missing environment/access/evidence; includes an exact recovery action |

Routine reviewers and documentation do not delay ready-to-test delivery.
The maintainer always runs asynchronously. It updates affected behavior,
architecture and contracts after source stabilizes; the primary reviews results
and records pending/updated paths. Full completion includes those updates.

Each human reply ends with **Follow-up:** an actor, concrete next action/location
and expected result. Background launch is not a verification PASS or proof that
memory was saved. You can send corrections while tasks run; they steer the active
request without restarting discovery.

## Resume a task

Before stopping, request: “Save the checkpoint, pending child IDs and exact next
action.” To continue in a new session in the **same worktree and branch**, send:

```text
resume
```

If several tasks exist, select the actual task ID:

```text
resume task TASK_ID
```

The agent reconciles source/environment and child state before continuing.
Passed checks can be reused only for unchanged inputs. A stopped host may interrupt
background work; saved IDs do not guarantee it completed. Never guess or relaunch
before establishing the previous task's state. An active owner must first park or
interrupt its task; never delete its database to bypass ownership.

## Parallel work

Use separate Git worktrees for developers/sessions that may touch the same files.
Commit approved shared instructions/docs before creating worktrees.
Each worktree needs its policy/docs, application environment and graph registration.
Checkpoints/graphs remain local to that worktree; linked worktrees may share the
developer's repository memory bank.

In the same checkout, assign disjoint files and coordinate shared contracts,
translations/manifests and indexes. Use unique ports where independent runtimes
need them, unique test data/report paths and scoped cleanup. Do not reset another
session's fixtures or stop its processes.

QA opens a private Chrome context per task with explicit page IDs; MCP
`--isolated` also separates OpenCode processes. Never share tabs, cookies or browser
storage between tasks. If QA reports AUTH_REQUIRED, sign in directly in its owned
private browser/password manager, then ask the primary to resume the same child.
Do not send passwords/MFA in chat. Only a verified non-secret login recipe is
eligible for memory; a fresh private context can still require fresh sign-in.

## Documentation developers share

Use `docs/agent-context/README.md` as the entry point, then read only relevant
records and linked source/tests. Common categories are `architecture/`,
`decisions/`, feature records where present, `frontend/`, `backend/` and `testing/`.
The actual branch policy determines mandatory edit evidence. Missing records are
reported as documentation gaps, never invented as implemented facts.

Maintainer updates travel with implementation in the same branch/PR.
Reviewed main-branch documentation reaches other developers through normal Git
merge/rebase; unmerged branch records remain provisional outside their branch.
No separate Obsidian workspace or shared memory database is required.
See [documentation workflow](WORKFLOW.md#documentation-maintenance).

ADRs use `decisions/ADR-NNNN-topic.md`, with status, scope, source paths, decision,
rationale and verification. New decisions start proposed; acceptance requires
approved design and reviewed evidence. Preserve accepted records and supersede
them through a new ADR; resolve numbering collisions before acceptance.

## Recovery and upgrades

[Operations and recovery](OPERATIONS.md) covers missing tools, stale runtime,
graph/memory failures, unavailable models, browser isolation, ownership and rollback.
Graph/memory failures never justify refusing authorized runtime scripts or tests.
Shell commands follow the current agent's native permissions; guarded native edits
still require preparation and ownership.

To upgrade: save active checkpoints, finish/park child tasks, fetch the reviewed
source, back up personal config, reinstall, reapply personal overrides and fully
restart hosts. Repeat affected onboarding checks. Keep one coherent installed
runtime version across your sessions; the global installation is shared within
your Windows account. Do not delete checkpoint/memory databases for an upgrade.

## Using a release ZIP

Verify the supplied archive hash before extracting:

```powershell
$archivePath = 'C:\Downloads\opencode-sdlc-harness.zip' # Your release file.
(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
Get-Content -LiteralPath ($archivePath + '.sha256')
```

Extract separately. `PACKAGE-MANIFEST.json` identifies the exported commit/files.
Copy the harness into the application checkout and review/merge the supplied
instructions/context profile; preserve newer team policy. The archive contains
neither application source nor personal credentials/runtime databases.
Only committed changes enter an exported release; see
[packaging](OPERATIONS.md#build-another-shareable-package).

## References

- [Harness internals and guard limits](../README.md)
- [Detailed handoff/QA/documentation recipes](WORKFLOW.md)
- [Local Hindsight installation and memory verification](HINDSIGHT-SETUP.md)
- [OpenCode configuration](https://opencode.ai/docs/config/) and [providers](https://opencode.ai/docs/providers/)
- [uv installation](https://docs.astral.sh/uv/getting-started/installation/)
- [WSL installation](https://learn.microsoft.com/windows/wsl/install)

Commands and examples follow the pinned harness baseline. Clean-machine onboarding
and desktop UI checks must be verified on the developer's own environment.
