# Local Hindsight setup

Complete this to enable local experience memory. Coding may continue with Git
docs/checkpoints while memory setup is pending. Windows OpenCode connects
to a developer-owned WSL daemon on `http://127.0.0.1:9077`. The daemon performs
memory extraction; the native Coding Agents plugin captures/injects conversations.
Neither replaces the reviewed Git documentation or local task checkpoints.

## A. Install uv inside WSL

Open your Ubuntu distribution, finish its user setup, then run **inside WSL**:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
~/.local/bin/uv --version
```

The following commands use the verified `hindsight-embed==0.10.3` release.
First startup can download embedded database/runtime/model dependencies.

## B. Choose one daemon authentication route — manual

### Route 1: approved LLM-provider API key

Run **inside WSL**:

```bash
~/.local/bin/uvx --from hindsight-embed==0.10.3 hindsight-embed configure -p coding-agent --port 9077
```

Follow the interactive provider/model prompts and enter your own approved key
in the masked credential prompt. `configure` is deprecated upstream but remains
supported in the pinned 0.10.3 CLI. This route avoids putting a literal key in
the shared instructions or shell history. Use the provider/model your team has
approved; access and billing belong to that account.

Daemon-side provider settings are `HINDSIGHT_API_LLM_PROVIDER`,
`HINDSIGHT_API_LLM_MODEL` and `HINDSIGHT_API_LLM_API_KEY`. The configuration
wizard stores them in your local profile. They are different from the optional
client/API authentication token used to protect the Hindsight service itself.
Do not put the daemon's LLM key into the Windows Coding Agents JSON file.

### Route 2: your own Codex sign-in

Install Node/npm **inside WSL** using your approved Node installation procedure.
Verify `node --version` and `npm --version` resolve Linux executables, rather
than Windows interop paths. Then install the Codex CLI inside WSL:

```bash
npm install -g @openai/codex
codex --version
codex login --help
mkdir -p ~/.hindsight/codex-auth
```

Use this dedicated auth home so Hindsight does not refresh a credential file
actively shared with another Codex process. In
`~/.hindsight/codex-auth/config.toml`, set:

```toml
cli_auth_credentials_store = "file"
```

Login/storage behavior follows the official
[OpenAI authentication documentation](https://developers.openai.com/codex/auth/).

This is a private local directory, not a repository file. Sign in using the
command supported by your installed CLI:

```bash
CODEX_HOME="$HOME/.hindsight/codex-auth" codex login
```

If browser callback login is unavailable and local help supports it, use
`codex login --device-auth` with the same `CODEX_HOME`. Complete the browser/device
flow with your own account. Confirm that this auth home contains `auth.json`
without opening or printing it. Managed account restrictions can limit login
methods or file storage. Follow your administrator's approved authentication
method if file storage is prohibited.

Configure Hindsight to use that exact auth home:

```bash
~/.local/bin/uvx --from hindsight-embed==0.10.3 hindsight-embed profile create coding-agent --port 9077 \
  --env HINDSIGHT_API_LLM_PROVIDER=openai-codex \
  --env HINDSIGHT_API_LLM_CODEX_HOME="$HOME/.hindsight/codex-auth"
```

Do not set a generic `CODEX_HOME` profile variable instead: the embedded manager
forwards `HINDSIGHT_*` settings to its API worker. Leave the Codex model unset
initially unless your account needs another supported model. This integration
route is provided by Hindsight; account/model access must be verified by the
write/read check below. Do not copy or share another developer's auth cache.

## C. Start the profile and check health

**WSL:**

```bash
~/.local/bin/uvx --from hindsight-embed==0.10.3 hindsight-embed -p coding-agent daemon start
~/.local/bin/uvx --from hindsight-embed==0.10.3 hindsight-embed -p coding-agent daemon status
```

**Windows PowerShell:**

```powershell
Invoke-RestMethod http://127.0.0.1:9077/health -TimeoutSec 10
```

Expected: `status: healthy`, `database: connected`. If the API is already running
on 9077, inspect its owner/profile before starting another instance. A health
response does not prove LLM credentials, extraction or automatic capture.

## D. Install the Windows native plugin

**PowerShell:**

```powershell
npx -y @vectorize-io/hindsight-coding-agents@0.8.1 install opencode --server self-hosted --api-url http://127.0.0.1:9077
```

This installer registers the native plugin under your own user profile, matching
`%USERPROFILE%\.hindsight\coding-agents`. Keep its registered plugin path when
merging the supplied OpenCode template; it has no duplicate `plugin` entry.
It can update personal configuration: back up an existing config first and
inspect its result. Do not add a second Hindsight MCP server.

Use `self-hosted` mode even though the service is local: WSL already manages the
daemon. Windows plugin `daemon` mode can try to launch another embedded service.

Merge [`hindsight.example.json`](../config/hindsight.example.json) into
`%USERPROFILE%\.hindsight\coding-agent.json` and replace `optInPaths` with your
actual main Git checkout path. Preserve other approved paths/settings. Ensure
the configuration has:

| Setting | Purpose |
| --- | --- |
| `serverMode: self-hosted`, API URL on 9077 | Reuse the WSL service |
| `bankIdTemplate: coding-agent::{gitProject}` | Stable repository bank |
| `resolveWorktrees: true` | Linked worktrees share the main repo's memory bank |
| `optInOnly: true`, your `optInPaths` | Explicit repository enrollment |
| `retainSessions: true` | Automatic transcript capture |
| `autoInject: recall`, low budget/1000 tokens | Bounded recall, no routine reflection call |
| `recallOptions.types: [world, experience]` | Retrieve retained facts without depending on observation consolidation |
| `autoSeed: false`, `codebaseSurvey: false` | Avoid an automatic whole-codebase ingestion/survey |
| `autoUpdate: false` | Upgrade the pinned integration deliberately |

`apiToken`, when required by your service, authenticates the client to Hindsight.
It is not the daemon's LLM-provider key. Follow your team's local secret-storage
procedure; the package contains neither kind of credential.

## E. Create the first repository bank — manual, once

Automatic seeding is off, so a new bank may not exist. The automatic startup check
reads its statistics and reports failure on 404 until it is created. This warning
does not block coding; use Git docs/checkpoints while recovering memory access.

From the owning repository root, use the shipped resolver rather than guessing
the bank of a renamed checkout or linked worktree. Set `$repoRoot` as in the main
guide, then run **PowerShell**:

If you deliberately use `HINDSIGHT_CONFIG`, set `$memoryConfigPath` to that same
client configuration file instead of the default path below.

```powershell
$memoryConfigPath = Join-Path $env:USERPROFILE '.hindsight\coding-agent.json'
$memoryBank = node --input-type=module -e "import fs from 'node:fs'; import {resolveMemoryTarget} from './tools/opencode-harness/runtime/lib/memory-settings.mjs'; const raw=JSON.parse(fs.readFileSync(process.argv[1],'utf8').replace(/^\uFEFF/,'')); const target=resolveMemoryTarget(raw,process.argv[2]); if(target.cfg.disabled) throw Error('Repository is not opted in'); console.log(target.bankId);" "$memoryConfigPath" "$repoRoot"
if ($LASTEXITCODE -ne 0) { throw 'Memory bank resolution failed; fix the configuration first.' }
$escapedMemoryBank = [uri]::EscapeDataString($memoryBank.Trim())
Invoke-RestMethod -Method Put `
  -Uri "http://127.0.0.1:9077/v1/default/banks/$escapedMemoryBank" `
  -ContentType 'application/json' -Body '{}' -TimeoutSec 10
Invoke-RestMethod `
  -Uri "http://127.0.0.1:9077/v1/default/banks/$escapedMemoryBank/stats" `
  -TimeoutSec 10
```

A normal main checkout named `YellowStorm-poc` resolves to
`coding-agent::YellowStorm-poc`. An explicit path/bank mapping can change this.
The pinned API accepts `{}` for bank creation. If API authentication is enabled,
use your own client token in the request headers through your approved local
secret mechanism; do not paste it into this guide, chat or Git. An existing bank
does not require another initialization on every session.

## F. Verify a real memory write/read — manual acceptance

After the remaining OpenCode setup and full host restart, ask its primary agent:

```text
Verify local experience memory using one non-secret onboarding note with a
unique title. Use hindsight_ingest_document, then verify its asynchronous
extraction operation completed using the available sync/operation status tools.
Queued acceptance alone is PENDING, not a completed write. Use hindsight_reflect
once to retrieve the note's actual contents and source evidence from this bank.
Report PASS only with completed extraction and real read evidence. Failure or
timeout is BLOCKED. Do not change source or treat API health as extraction proof.
```

This small check may use the configured LLM and take longer than readiness.
Ingestion tool success can mean only that work was queued. Inspect supported
status tools such as `hindsight_sync_status` and the operation response rather
than assuming the return value is the completed extraction.
Do not repeat it at every startup. A provider/credential failure belongs to this
check even if health and bank statistics succeed.

Next send a harmless confirmed preference and let the normal reply finish.
Allow background extraction, then start a new session in the same repository
and ask whether that preference is available. Check this session's diagnostic
events if it is missing. A completed direct-ingest check does not itself prove
automatic transcript capture. Do not deliberately retain passwords, tokens,
private login fields or customer data in an onboarding test.

The local diagnostic file is
`%USERPROFILE%\.hindsight\coding-agents-logs\diag.jsonl`. Relevant event names
include `retain_ok`, `retain_failed`, `idle_fetch_failed`. Inspect bounded,
session-scoped records; sanitize any diagnostics before sharing them.

## G. Optional automatic start at Windows logon

In Task Scheduler create a task under the same Windows user that configured
Ubuntu/profile. Trigger: **At log on**. Do not start multiple concurrent instances.

- Program: `C:\Windows\System32\wsl.exe`
- Arguments (replace distribution/profile if different):

```text
-d Ubuntu-22.04 -- bash -lc "~/.local/bin/uvx --from hindsight-embed==0.10.3 hindsight-embed -p coding-agent daemon start"
```

Use the full WSL `uvx` path via `~/.local/bin/uvx`; logon tasks may not inherit
an interactive shell's PATH. No credential belongs in task arguments. Verify
Windows `/health` after logon; WSL shutdown terminates its processes.

## Local named-profile storage

| WSL path | Contents |
| --- | --- |
| `~/.hindsight/profiles/coding-agent.env` | Private named profile/provider configuration |
| `~/.hindsight/profiles/coding-agent.log` | Daemon log; sanitize before sharing |
| `~/.pg0/instances/hindsight-embed-coding-agent` | Embedded database state |

These are the pinned named profile's defaults, not files to add to the release.
The default (unnamed) profile uses different locations, including
`~/.hindsight/embed` and `~/.hindsight/daemon.log`. Do not edit or back up live
database files without the service's proper backup procedure.

## References

- [Hindsight installation](https://hindsight.vectorize.io/developer/installation).
- [Hindsight LLM providers and Codex authentication](https://hindsight.vectorize.io/developer/models).
- [Coding Agents native integration](https://github.com/vectorize-io/hindsight/blob/main/hindsight-integrations/coding-agents/README.md).
- [Official OpenAI authentication documentation](https://developers.openai.com/codex/auth/).
- [uv installation](https://docs.astral.sh/uv/getting-started/installation/).

Profile CLI commands and bank request schema were checked against local 0.10.3;
the optional Codex CLI login flow follows its current official documentation.
