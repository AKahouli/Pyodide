# Developer user guide: OpenCode SDLC harness

Install the harness in your own account, launch OpenCode from the intended Git
checkout, then use `build` for implementation and fixes. The harness preserves
task checkpoints, coordinates parallel edits and routes agents to reusable code
and Git documentation. Independent work runs in the background so you can keep
messaging the main agent.

This guide covers the verified **Windows + PowerShell** setup. OpenCode, Chrome
and the graphify structural graph all run on Windows; no WSL or memory service
is required. macOS/Linux installation is not verified by this Windows procedure.

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
| Task checkpoints and local baselines | `<worktree>/.opencode/sdlc/` | No |
| Structural graph | `<worktree>/graphify-out/` | No |
| Private browser state and QA evidence | Task-owned Chrome context; `qa-artifacts/<task-id>/<run-id>/` | No |

Each developer uses their own credentials. Reviewed documentation
travels with implementation in the same branch and PR.

## One-click installer

Finish/checkpoint active work, then double-click
[`Install-Harness.cmd`](../Install-Harness.cmd) in `tools/opencode-harness/`.
Run it from a reviewed checkout/release; the launcher uses a process-only execution
policy, subject to your organization's restrictions. It keeps the window open so
you can read the result. Internet access is needed for missing dependencies.

The script checks Git, Node 24+ and uv, installs missing prerequisites through
WinGet, installs the graphify CLI and its freshness hooks (building an initial
code-only graph when none exists), installs native Windows OpenCode **2.1.2** even
when V1 is present, installs the matching V2 SDK,
merges missing config defaults, installs the harness,
and prepares Chrome. It backs up existing personal settings, preserves
JSON/JSONC/provider configuration and serializes installers per Windows user.
It never stops an active OpenCode host. Detected OpenCode processes produce an
advisory warning with their PIDs; they do not block setup, including Desktop
processes left running after closing a window. Fully exit/restart OpenCode after
setup to load the installed changes. If a file is in use, exit the listed hosts
and rerun the installer. An existing Node older than 24 needs an upgrade before
rerunning. The CLI download uses the official versioned Windows artifact and
verifies its SHA-512 integrity before installation. x64 uses the baseline binary
for CPUs with or without AVX2; Windows ARM64 uses its native binary. No WSL is used.
The binary directory `%USERPROFILE%\.opencode\bin` is placed first in User PATH.
Setup rejects a machine-wide V1 command that still takes precedence. Open a new
terminal after setup and check `opencode --version`; an already open terminal keeps
its old PATH. Restart the terminal application or sign out/in if it still inherits
the old environment. The installer does not upgrade Desktop: install V2 Desktop
separately before launching it with the V2 harness.

For explicit command-line use, from the repository root:

```powershell
.\tools\opencode-harness\setup.ps1
# A separately extracted release can target an already prepared checkout:
.\tools\opencode-harness\setup.ps1 -RepoRoot 'C:\work\YellowStorm-poc'
```

If the release is outside a Git checkout, the launcher asks for the application's
root. That checkout must already contain the policy and its routed docs; merge the
release profile first. Setup does not overwrite team code/policy or clone a repository.

| Exit code | Meaning |
| --- | --- |
| 0 | Setup stages completed; restart, select accessible models and verify onboarding |
| 1 | Core setup failed; fix the displayed error before retrying |
| 2 | Harness installed, with Chrome/graphify steps pending; follow the displayed recovery instructions |

After completion, continue at [Verify onboarding](#verify-onboarding).
For managed/manual installation, use the steps below.

## First-time installation

### 1. Install prerequisites and choose the checkout

Install Git, Node **24 or newer with `node:sqlite`**, Windows uv/uvx and Chrome
Stable.

The tested dependency baseline is pinned below; these are not claims about the
latest releases. Upgrade deliberately and repeat onboarding checks.

| Component | Tested version |
| --- | --- |
| OpenCode CLI | 2.1.2 (native Windows) |
| OpenCode plugin SDK | `@opencode/plugin@2.1.2` |
| One-click JSON/JSONC configuration helper | `jsonc-parser@3.3.1` |
| Structural graph | `graphifyy` (PyPI; installed via `uv tool install graphifyy`) |
| Chrome MCP | `chrome-devtools-mcp@1.10.1` |

Use a normal developer PowerShell terminal for the remaining Windows commands:

```powershell
# Install the native Windows CLI using the same verified artifact as guided setup:
. .\tools\opencode-harness\setup.ps1
Install-SetupOpenCode
node --version
git --version
uv --version
opencode --version

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
npm install --prefix "$configDir" --save-exact @opencode/plugin@2.1.2
.\tools\opencode-harness\install.ps1
```

If script execution is blocked, use your organization's approved signing/policy
procedure. Where permitted, the process-only alternative is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\opencode-harness\install.ps1
```

The installer copies runtime files, global instructions, seven specialists and
four skills. Existing owned files are backed up under
`$configDir\.sdlc-backups/<timestamp-id>`.
It **does not merge your personal instructions** or install/configure the services.
It preserves `opencode.json`, provider credentials and repository policy.
Reconcile personal instruction/model overrides from the backup after installation.

Merge [opencode.example.json](../config/opencode.example.json) into the active
`opencode.json` or `opencode.jsonc` under your configuration directory.
Preserve provider settings. Do not create a competing config file or blindly
replace the existing one.

The template configures Chrome MCP with `--isolated --page-id-routing`,
Context7, specialist permissions, `experimental.subagent_depth` and context compaction.
The setup helper leaves supported V1 settings for OpenCode to normalize, avoiding
native defaults that would override personal V1 permissions, providers or agents.
It does not port personal third-party V1 plugins; those require V2 implementations.
Graph queries run through the graphify CLI with read-only bash permissions in
the agent files; no graph MCP server is registered.
For the shipped GPT-6 models and their listed speed variants, the template caps
the input budget at 460,000 tokens with a 60,000-token compaction reserve:
automatic compaction starts at 400,000 reported context tokens. The actual model
context capacity remains 1,050,000; this is a configured working budget. OpenCode
checks usage between steps, so a large response can cross the threshold
before compaction starts. This counts current context usage, including cached
tokens, rather than cumulative tokens spent across the session. Recent context
retention is configured at 20,000 tokens. Smaller models retain their native
earlier thresholds; never increase their advertised capacity to reach 400,000.
Other large models need an equivalent input-budget override based on verified
model limits. Existing personal model/buffer overrides survive installer merges
and must be reconciled to obtain the same threshold. Restart hosts after changes.
The SDLC plugin is discovered from `plugins/sdlc.js`; do not also register it in
the `plugins` array.

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

V2 provides native background subagent execution; the V1
`OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` flag is no longer installed by setup.
Use only the arguments exposed by the installed subagent tool. Restart the
OpenCode host after upgrading the runtime and agents.

### 3. Install graphify and its freshness hooks

Graphify is a persistent CLI tool, not an MCP server: the git hooks re-run
`graphify` after commits/checkouts, which an ephemeral `uvx` cache cannot
guarantee. Install it and prepare the graph once per checkout/worktree:

```powershell
uv tool install graphifyy
graphify --version
# Build the initial code-only graph (local AST parsing; no API key, no LLM):
graphify extract "$repoRoot" --code-only --no-viz
# Install the freshness hooks and verify them:
graphify hook install
graphify hook status
```

Expected `graphify hook status`: `post-commit`, `post-checkout`, `post-merge`
and `post-rewrite` each report `installed`, plus the registered merge driver.
The hooks rebuild `graphify-out/` in the background after commits and branch
switches; a query immediately after a commit can briefly see the old graph.

Freshness workflow:

- After `git pull` or a merge, run `graphify update .` explicitly (incremental,
  code-only, no LLM needed).
- Use `graphify update . --force` only after refactors that deleted code.
- Queries answer against the current directory's `graphify-out/graph.json`;
  pass `--graph <path>` for another worktree's graph.

Check the graph answers questions before onboarding:

```powershell
graphify query "where is request validation?" --budget 800
graphify explain "a well-known-symbol" --graph "$repoRoot\graphify-out\graph.json"
```

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
for graph and checkpoints, the actual repository root and loaded harness
version. Reuse native results; do not repeat passing diagnostic calls.
For any failure, give the specific recovery action and say whether coding can
continue.
```

Expected runtime for this guide: `2026-10-22-opencode-v2`.
The SDLC tools are `sdlc_checkpoint`, `sdlc_resume` and `sdlc_health`.

| Startup result | Expected action |
| --- | --- |
| All PASS | Start work; no repeated diagnostics |
| Graph FAIL or pending | Report the problem; continue with source/tests and Git docs |
| Checkpoint storage FAIL | Continue coding; repair checkpoint memory separately |
| Missing tools or old runtime | Repair installation and fully restart the host |

After recovery, request `sdlc_health(refresh: true)`. Health proves availability,
not complete graph coverage or application readiness.

For automated regression checks, from the Git root:

```powershell
node --test tools/opencode-harness/tests/*.test.mjs
```

Use the runner's actual result; no fixed test count is an installation guarantee.
Tests use disposable repositories/mocked integrations. They do not validate your
provider sign-in or application. Report failed tests with the failing policy/path;
do not remove guards to obtain a green result.

For a model-free native V2 plugin loading/tool/checkpoint smoke check:

```powershell
node tools/opencode-harness/tests/live-v2.mjs
```

This uses a disposable repository/config and its own localhost server, without
provider credentials or model calls. It requires the native V2 executable and
SDK installed above. It does not verify desktop GUI behavior or background
subagent execution. The older `live-background.mjs`, `live-startup.mjs` and
`live-opencode.mjs` runners use the V1 server API and are historical fixtures;
do not use them to qualify V2.

In your desktop session, request one bounded background task, then send another
message while it runs. Expect the main agent to answer and later report completion.
Prefer background maintainer tasks when the current Task schema supports them. If background execution is unavailable, the primary completes the exact scoped documentation directly using the existing handoff and evidence; a bounded foreground maintainer is also allowed when useful. Do not invent unsupported arguments, ask for authorization again, or leave documentation pending solely because background routing is unavailable.

The [parallel readiness procedure](PARALLEL-VERIFICATION.md) is a historical V1
procedure and needs a V2 API port before use.

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
Prefer asynchronous maintenance when supported; otherwise the primary completes
the scoped documentation directly. Maintenance updates affected behavior,
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
interrupt its task; preserve its database and coordinate changes through normal handoffs.

## Parallel work

Use separate Git worktrees for developers/sessions that may touch the same files.
Commit approved shared instructions/docs before creating worktrees.
Each worktree needs its policy/docs, application environment, `graphify-out/`
graph and its own `graphify hook install` (hooks live in each clone/worktree).
Checkpoints and graphs remain local to that worktree.

In the same checkout, assign disjoint files and coordinate shared contracts,
translations/manifests and indexes. Use unique ports where independent runtimes
need them, unique test data/report paths and scoped cleanup. Do not reset another
session's fixtures or stop its processes.

QA opens a private Chrome context per task with explicit page IDs; MCP
`--isolated` also separates OpenCode processes. Never share tabs, cookies or browser
storage between tasks. If QA reports AUTH_REQUIRED, sign in directly in its owned
private browser/password manager, then ask the primary to resume the same child.
Do not send passwords/MFA in chat. Only a verified non-secret login recipe is
recorded in task checkpoints; a fresh private context can still require fresh
sign-in.

## Documentation developers share

Use `docs/agent-context/README.md` as the entry point, then read only relevant
records and linked source/tests. Common categories are `architecture/`,
`decisions/`, feature records where present, `frontend/`, `backend/` and `testing/`.
The actual branch policy determines mandatory edit evidence. Missing records are
reported as documentation gaps, never invented as implemented facts.

Maintainer updates travel with implementation in the same branch/PR.
Reviewed main-branch documentation reaches other developers through normal Git
merge/rebase; unmerged branch records remain provisional outside their branch.
No separate memory service or shared memory database is required.
See [documentation workflow](WORKFLOW.md#documentation-maintenance).

ADRs use `decisions/ADR-NNNN-topic.md`, with status, scope, source paths, decision,
rationale and verification. New decisions start proposed; acceptance requires
approved design and reviewed evidence. Preserve accepted records and supersede
them through a new ADR; resolve numbering collisions before acceptance.

## Recovery and upgrades

[Operations and recovery](OPERATIONS.md) covers missing tools, stale runtime,
graph failures, unavailable models, browser isolation, ownership and rollback.
Graph failures never justify refusing authorized runtime scripts or tests.
Shell commands follow the current agent's native permissions; native edits
require no harness preparation or file reservation.

To upgrade: save active checkpoints, finish/park child tasks, fetch the reviewed
source, back up personal config, reinstall, reapply personal overrides and fully
restart hosts. Repeat affected onboarding checks. Keep one coherent installed
runtime version across your sessions; the global installation is shared within
your Windows account. Do not delete checkpoint databases or `graphify-out/`
for an upgrade; `graphify update .` refreshes the graph after pulls.

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
- [Graphify documentation](https://docs.graphify.com)
- [OpenCode V2 migration](https://opencode.ai/v2/docs/migrate-v1/), [configuration](https://opencode.ai/v2/docs/config/) and [providers](https://opencode.ai/v2/docs/providers/)
- [uv installation](https://docs.astral.sh/uv/getting-started/installation/)

Commands and examples follow the pinned harness baseline. Clean-machine onboarding
and desktop UI checks must be verified on the developer's own environment.
