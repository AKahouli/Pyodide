# Developer setup: OpenCode SDLC harness

Start here. This is the Windows setup used for this harness, with Hindsight in
WSL and OpenCode/Chrome/graph tools on Windows. Commands marked **PowerShell**
run on Windows; commands marked **WSL** run inside Ubuntu. Do not mix their paths.
macOS/Linux users can reuse the runtime and policy, but this Windows installer
and service-start procedure have not been verified there.

## What you receive

| Included in the ZIP | Installed/downloaded separately |
| --- | --- |
| Native runtime, SQLite checkpoints and health checks | OpenCode, Node/npm, Git, Windows uv/uvx |
| Seven specialist agents and three skills | Hindsight Coding Agents plugin and WSL daemon |
| Configuration examples, installer and tests | Chrome and graph MCP packages |
| Repository `AGENTS.md`, frontend/backend instructions and Git context/ADRs | Your own model-provider sign-in; application runtime and QA account |
| Commit manifest and file hashes | Optional Context7 account/API key |

The ZIP contains the harness and reviewed YellowStorm documentation profile,
not the application source. Use it with a normal YellowStorm Git checkout.
Links from the profile to application READMEs/source resolve in that checkout.
Credentials, private sessions, memory databases, browser profiles, `.env`,
checkpoint databases, graphs and installed dependencies are not exported.

Manual steps: prerequisites, repository paths, provider sign-in, Hindsight
configuration, the first memory bank, initial graph indexing, service startup,
model selection and application/QA access. The harness installer only copies
its runtime, agents, skills and global instructions, with backups.

## 1. Install prerequisites — manual, once per developer

Install Git, Node **24 or newer with `node:sqlite`**, Google Chrome Stable,
and Windows uv from their official distributions. Node 24 is the documented
baseline. Install WSL/Ubuntu if you do not already have a working distribution.
WSL installation can require administrator access and a Windows restart.

**PowerShell:**

```powershell
# Administrator terminal only if WSL is not installed:
wsl --install -d Ubuntu-22.04

# Normal developer terminal:
npm install -g opencode-ai@1.18.34
node --version
git --version
uv --version
uvx --version
opencode --version
wsl --list --verbose
```

Complete Ubuntu's first-run user setup. Windows uv and WSL uv are separate
installations. The desktop is optional; CLI 1.18.34 is the verified integration
baseline. Desktop Node 24.15 graph reading was also checked; a complete GUI
onboarding on a clean developer machine remains an acceptance check.

Pinned integration versions:

| Component | Version |
| --- | --- |
| OpenCode CLI | 1.18.34 |
| `@opencode-ai/plugin` (and its SDK dependency) | 1.1.42 |
| `code-review-graph` | 2.3.9, core package |
| `chrome-devtools-mcp` | 1.10.1 |
| `@vectorize-io/hindsight-coding-agents` | 0.8.1 |
| `hindsight-embed` / local API | 0.10.3 |

Do not replace these with `latest` during initial onboarding. Upgrade components
deliberately and rerun the verification below. The optional Codex login CLI has
its own release cycle; its local help is authoritative for login flags.

## 2. Prepare the Git checkout and paths — manual

Clone the team's application repository and check out the agreed branch. Compare
the ZIP's SHA256 with the supplied `.zip.sha256` before extracting:

```powershell
$archivePath = 'C:\Downloads\opencode-sdlc-harness.zip' # Your downloaded file.
(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
Get-Content -LiteralPath ($archivePath + '.sha256')
```

Extract
the ZIP separately, for example under `C:\work\harness-release`. In that folder,
`PACKAGE-MANIFEST.json` records the source commit and every exported file hash.

Set these values in your **PowerShell** terminal:

```powershell
$repoRoot = 'C:\work\YellowStorm-poc'  # Replace with YOUR Git checkout.
$releaseRoot = 'C:\work\harness-release\opencode-sdlc-harness'
$configDir = Join-Path $env:USERPROFILE '.config\opencode'
Set-Location -LiteralPath $repoRoot
git rev-parse --show-toplevel
```

If the checkout already includes this harness commit, use its files directly.
Otherwise copy `tools/opencode-harness` from the release into the same path in
your checkout. Review/merge the supplied root `AGENTS.md`, frontend/backend
`AGENTS.md` and `docs/agent-context/` profile; do not overwrite newer team policy.
Keep the directory layout intact. Commit approved shared instructions and docs
before creating additional worktrees.

Verify that `tools/opencode-harness/policy.json` exists in the Git root. Its
YellowStorm routes require these existing files:

- `docs/agent-context/README.md`
- `YellowStorm/front/AGENTS.md`
- `YellowStorm/back/AGENTS.md`
- `yellowstorm-adk/README.md`
- `tools/opencode-harness/README.md`

Ensure the repository's `.gitignore` contains:

```gitignore
.opencode/
.code-review-graph/
qa-artifacts/
```

Other repositories: adapt the root/scoped instructions and use
[`policy.generic.example.json`](../config/policy.generic.example.json) as a
starting point, replacing routes with real paths/documents. Create a compact
`docs/agent-context/README.md` and the routed scoped documents before edits.
Do not copy YellowStorm's architecture claims into another application.

## 3. Configure local Hindsight — manual, once per developer

Hindsight stores experience locally and uses a configured LLM for extraction and
reflection. Choose **one** authentication route in
[Hindsight setup](HINDSIGHT-SETUP.md): your approved provider API key, or your own
Codex sign-in in a dedicated WSL auth home. Complete that guide through daemon
health, Windows plugin installation and first-bank creation before continuing.

Expected Windows result:

```powershell
Invoke-RestMethod http://127.0.0.1:9077/health -TimeoutSec 10
# status: healthy; database: connected
```

One daemon serves parallel sessions. No developer receives another person's
credentials or memory database. Experience is per developer/repository by
default; the shared team context is reviewed Git documentation.

## 4. Install the plugin SDK and harness — automatic file copy

**PowerShell, from the Git root:**

```powershell
npm install --prefix "$configDir" --save-exact @opencode-ai/plugin@1.1.42
.\tools\opencode-harness\install.ps1
```

If Windows blocks an unsigned script, use a process-only policy in a terminal
where your organization permits it, or obtain an approved signature:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\opencode-harness\install.ps1
```

The installer backs up overwritten harness files to
`$configDir\.sdlc-backups\<timestamp-id>`. It replaces its global `AGENTS.md`,
seven named agents, runtime files and three skills. It does not merge instructions
automatically; reconcile any personal rules from the backup afterwards.
It does not replace `opencode.json`, provider credentials or the project policy.

## 5. Merge OpenCode settings and choose models — manual

Back up your personal `opencode.json`/`opencode.jsonc` before editing.
Merge the relevant sections from
[`opencode.example.json`](../config/opencode.example.json) into the active config
under `%USERPROFILE%\.config\opencode`. Do not blindly replace an existing config
or create a competing JSON/JSONC file. Preserve working provider settings and
the native Hindsight plugin registered in step 3.
Configuration sources can merge/override one another; see the official
[OpenCode precedence rules](https://opencode.ai/docs/config/#precedence-order).

The supplied template contains:

- Graph MCP: `uvx --from code-review-graph==2.3.9 code-review-graph serve`.
- Chrome MCP: `chrome-devtools-mcp@1.10.1 --isolated --page-id-routing`.
- Context7's public MCP endpoint, configurable for your team's access.
- Primary-to-specialist permissions, bounded subagent depth and compaction.
- Hindsight's native plugin is registered separately by step 3, not another MCP.

Preserve that registered `plugin` entry; the template intentionally does not
duplicate it. In the tested Windows CLI, substituting `{env:USERPROFILE}` inside
a JSON plugin path can introduce unescaped backslashes and invalidate the config.
Keep the installer-generated path rather than replacing it with that expression.

The SDLC plugin is discovered from `plugins/sdlc.js`; do not also list it in the
`plugin` array and load it twice. On your first OpenCode launch, connect your own
provider using `/connect`, then select an available model with `/models`. You can
persist `model` and `small_model` using actual provider/model IDs from that list.
The template deliberately does not assume a personal proxy URL or model catalog.

**Important manual model choice:** check every installed file under
`$configDir\agents`, not only the primary model:

| Agents | Shipped explicit model |
| --- | --- |
| `diagnostics`, `plan`, `reviewer`, `frontend-qa` | `openai/gpt-6.1-sol` |
| `explore`, `maintainer` | `openai/gpt-6-luna` |
| `worker` | Inherits the primary model |

For every unavailable override, remove its `model:` line to inherit the primary
or choose an actual model offered by your provider. The specialist reasoning
settings must also be supported. Reapply personal overrides after upgrades from
the installation backup. Restart the host after changing agent files.

Enable the tested native background-task feature in **PowerShell**:

```powershell
$env:OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = '1'
[Environment]::SetEnvironmentVariable('OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS', '1', 'User')
```

The first line affects this terminal and its child processes; the second persists
the setting for future processes. Launch the CLI from that terminal initially.
Fully restart desktop hosts too; sign out/in if the desktop launcher still has
the old environment. `subagent_depth` alone does not enable background tasks.

Context7 account/key setup is optional for its public endpoint, subject to its
current service limits. If your team requires a key, configure its documented
authentication in your personal config. The `context7-mcp` skill is included.
Other optional design skills allowed by policy are not bundled; install them
separately only if the team uses them.

## 6. Build and register the code graph — manual, once per checkout

**PowerShell:**

```powershell
uvx --from code-review-graph==2.3.9 code-review-graph build --repo "$repoRoot"
uvx --from code-review-graph==2.3.9 code-review-graph status --repo "$repoRoot" --json
uvx --from code-review-graph==2.3.9 code-review-graph daemon add "$repoRoot" --alias YellowStorm-poc
```

Use your checkout's alias if different. The one-time build can take time for a
large repository; do it before starting a coding session. CLI status should show
`nodes > 0`, `files > 0` and `build_incomplete: false`. Its field names differ from
MCP statistics. A matching `built_at_commit`/`current_sha` is a committed-source
freshness anchor; it does not prove every uncommitted edit is indexed.

The health check reads `$repoRoot\.code-review-graph\graph.db`. Keep the default
data directory; external `--data-dir` is not supported by this check. The core
package supplies structural indexing; embeddings/PyTorch are not prerequisites.
For later source changes use an incremental update, not a routine full rebuild:

```powershell
uvx --from code-review-graph==2.3.9 code-review-graph update --repo "$repoRoot"
```

## 7. Start background services — manual, once per login

Start the WSL Hindsight daemon as described in its guide. Separately, Windows
graph `daemon start` stays in the foreground; start **one shared watcher**, not
one per OpenCode session. Check first whether a watcher is already running.

**PowerShell:**

```powershell
uvx --from code-review-graph==2.3.9 code-review-graph daemon status

# If not running: one hidden process for this Windows user.
$uvxPath = (Get-Command uvx.exe).Source
Start-Process -FilePath $uvxPath -WindowStyle Hidden -ArgumentList @(
  '--from', 'code-review-graph==2.3.9', 'code-review-graph', 'daemon', 'start', '--foreground'
)

uvx --from code-review-graph==2.3.9 code-review-graph daemon status
```

`daemon add` stores watched paths in
`%USERPROFILE%\.code-review-graph\watch.toml`. Only registered paths are watched.
For a second worktree, register that path too and build its own graph.

Optional automatic logon: use Task Scheduler under the same Windows user.
Create a graph task with program equal to `$uvxPath` and arguments
`--from code-review-graph==2.3.9 code-review-graph daemon start --foreground`.
Create a separate WSL Hindsight task using the exact action in its guide.
Set each task to avoid a second concurrent instance. Verify both after logon.
The package does not silently register tasks or keep services running for you.

## 8. Verify setup — manual acceptance checks

Close **all OpenCode host processes/windows**, then start a new one from your
repository. Creating another chat inside an old host does not reload plugins.

First send:

```text
Verify onboarding without source edits. Use the automatic startup result and
report graph, Hindsight and checkpoint statuses plus the loaded harness version.
Do not repeat diagnostic tool calls when the native checks already passed.
```

Expected: graph/Hindsight/checkpoints **PASS**, loaded harness
`2026-10-13-advisory-integrations`, and tools `sdlc_checkpoint`, `sdlc_prepare`,
`sdlc_resume`, `sdlc_diff`, `sdlc_health`. Failure must be visible with a recovery
action. After fixing a reported problem, retry `sdlc_health(refresh: true)`;
do not rebuild a healthy graph because another integration failed. Graph/Hindsight
failures or pending checks never block coding: use source/tests and Git docs/checkpoints.
Actual checkpoint storage and file ownership still protect native edits.

Run the behavioral suite from the repository root:

```powershell
node --test tools/opencode-harness/tests/*.test.mjs
```

The Windows distribution baseline has **44 passing tests**: 42 runtime tests
and two installer preservation/failure checks, including 12 simultaneous
first-time checkpoint initializations, independent process receipts, interrupted
edits, reuse gates and stale-event recovery. Tests use disposable repositories
and a mocked memory API; they do not validate your actual sign-in or application.

For a real parallel readiness check, in **two separate PowerShell terminals**:

```powershell
# Terminal A, repository root:
Set-Location -LiteralPath $repoRoot
opencode serve --hostname 127.0.0.1 --port 6193

# Terminal B, frontend directory:
Set-Location -LiteralPath (Join-Path $repoRoot 'YellowStorm\front')
opencode serve --hostname 127.0.0.1 --port 6194
```

Each terminal needs its own `$repoRoot` value. In a third terminal from the root:

```powershell
node tools/opencode-harness/tests/live-startup.mjs "$repoRoot"
```

Expected: two distinct process/session/probe identities, all checks PASS and
`diagnosticModelToolCalls: 0`. These localhost test servers use no model reply;
stop both afterwards with Ctrl+C. The test currently assumes those ports and
no server password; use it only for local onboarding, not a public server.
Readiness proves availability/configuration, not future LLM memory extraction.
Complete the memory write/read check in [Hindsight setup](HINDSIGHT-SETUP.md).

For background-task acceptance, ask the primary to run one bounded read-only
`explore` task with native `Task(background: true)` while it answers another
independent question. It should return a background task ID promptly and receive
completion automatically. If unsupported, verify the feature flag/host version;
do not pretend a foreground task ran in the background or poll repeatedly.

## 9. Verify private frontend QA and login — manual access

Start the application using its own README and development/test configuration;
the harness does not provision application databases or test accounts.
Give the primary agent the URL/route and one observable UI criterion.

Frontend QA must create `new_page` with a globally unique
`isolatedContext: "qa-<session-and-run-id>"` and retain the returned `pageId`.
Every page operation uses that ID. `--isolated` separates MCP processes;
different named contexts separate tasks inside the same process. Reusing a
context name shares its storage. Browser ownership is agent policy, not a
hard page-ID access-control boundary in this plugin.
The upstream [context/tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)
defines `isolatedContext`; the pinned tool schema remains authoritative.

If sign-in is needed, expect `BLOCKED / AUTH_REQUIRED` with the private context,
page ID and login URL. Sign in yourself in that browser/password manager, then
tell the primary to resume the same QA child/context. It stores a confirmed
non-secret login recipe in Hindsight, not your password, cookies or MFA codes.
A new private context can still require a fresh sign-in.

Evidence belongs under `qa-artifacts/<task-id>/<run-id>/`. Chrome MCP 1.10.1 also
restricts file writes: the host must provide appropriate MCP roots or a permitted
`--workspace`. If evidence saving is blocked, configure the active repository's
workspace in its project MCP override; do not enable unrestricted filesystem
access or save evidence into source paths. Missing isolation/routing capabilities
must produce `BLOCKED / BROWSER_ISOLATION`.

## 10. Normal use, interruption and documentation

- Give a goal and observable requirements; the primary asks for material missing
  decisions/access, not confirmation for each routine step. For substantial
  testable phases, choose end to end or phase pauses once for the task.
- Before edits, the agent checkpoints, reads matching Git docs and existing code,
  then prepares exact owned files with a reuse decision. Disjoint work can run
  in parallel; overlapping edits need coordination or separate worktrees.
- After interruption, send `resume` or `resume task TASK_ID`. Multiple unfinished
  candidates require selection. New ordinary requests do not adopt old tasks.
- Every human reply ends with **Follow-up:** who does what next, where, and the
  expected result or verification. Avoid abstract lesson-only endings or routine
  approval requests. Hindsight capture is asynchronous; a reply is not proof that
  memory extraction succeeded.
- Git docs live in `docs/agent-context/`: `architecture/`, `decisions/`,
  `frontend/`, `backend/`, `testing/`, routed by `README.md`. Code/graph checks
  establish implementation; reviewed docs establish approved intent; experience
  is fallible background context.
- Changed boundaries, runtime, persistence or durable decisions update owning
  architecture references. ADRs use `decisions/ADR-NNNN-topic.md`, status, scope,
  source paths, decision, rationale and verification. Start new decisions as
  `proposed`; accept after approval/review. Supersede accepted ADRs with new
  records rather than rewriting their history; update the index.
- Creating a new schema/table/collection, module/service/runtime or microservice
  requires approval of the concrete design. A generic end-to-end instruction is
  not approval of a new architecture.
- Ready-to-test delivery follows focused checks and relevant frontend QA.
  Routine reviewer/maintainer tasks are not delivery gates; high-risk changes
  still require independent review before full completion.

See [operations and recovery](OPERATIONS.md) for upgrades, rollback and
troubleshooting. There is no automatic memory upload to the shared Git docs.

## Official references

- [OpenCode configuration](https://opencode.ai/docs/config/), [plugins](https://opencode.ai/docs/plugins/) and [providers](https://opencode.ai/docs/providers/).
- [uv installation](https://docs.astral.sh/uv/getting-started/installation/).
- [WSL installation](https://learn.microsoft.com/windows/wsl/install).
- [Graph commands](https://github.com/tirth8205/code-review-graph/blob/main/docs/COMMANDS.md).
- [Chrome advanced usage](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md) and [tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md).

Commands were checked against the pinned installed CLI/help and runtime source;
upstream latest documentation can describe newer behavior.
