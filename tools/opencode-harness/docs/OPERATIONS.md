# Operations, recovery and updates

See [developer setup](DEVELOPER-SETUP.md) for the numbered first installation and
[runtime guide](../README.md) for checkpoint semantics and enforcement limits.

## Where each layer lives

| Layer | Location / ownership |
| --- | --- |
| Versioned harness source | `<repo>/tools/opencode-harness/` |
| Reviewed team knowledge | `<repo>/docs/agent-context/`, root/scoped `AGENTS.md`, owning READMEs/contracts |
| Installed personal runtime/agents/skills | `%USERPROFILE%\.config\opencode/{plugins,lib,agents,skills}` |
| Personal OpenCode/provider settings | `%USERPROFILE%\.config\opencode/opencode.json` or `.jsonc` |
| Harness installation backups | `%USERPROFILE%\.config\opencode/.sdlc-backups/<timestamp-id>` |
| Memory client enrollment/config | `%USERPROFILE%\.hindsight/coding-agent.json` |
| Experience storage / provider profile | Developer's WSL Hindsight daemon/profile; not the Git repo |
| Local transcript diagnostics | `%USERPROFILE%\.hindsight/coding-agents-logs/diag.jsonl` |
| Task state, receipts, ownership, local baselines | `<worktree>/.opencode/sdlc/checkpoints.sqlite` and SQLite WAL/SHM |
| Structural graph | `<worktree>/.code-review-graph/graph.db` |
| Shared graph watcher enrollment | `%USERPROFILE%\.code-review-graph/watch.toml` |
| Sanitized browser evidence | `<repo>/qa-artifacts/<task-id>/<run-id>/` |

Each developer owns credentials and experience storage. Linked worktrees can
share their developer's repository memory bank; they keep separate graphs and
checkpoint stores. A ZIP release never transfers those runtime databases.

## Troubleshooting

| Symptom | Check / recovery |
| --- | --- |
| `sdlc_health` missing | SDK installed, `plugins/sdlc.js` discovered, correct config directory; fully restart the host. Do not list the SDLC plugin twice. |
| Old loaded version / same failures in new chats | Stop the entire host, reinstall from the intended source commit, restart. New chat alone cannot reload cached plugin code. |
| Checkpoints FAIL / missing policy | Launch in the intended Git checkout; verify `tools/opencode-harness/policy.json`, committed HEAD, local writable `.opencode/sdlc/` and routed documents. |
| Checkpoint initialization lock budget exceeded | Identify competing writers, live owner or a nonlocal/symlinked store; recover the environment, then refresh health. Do not delete an active database to clear ownership. |
| Graph FAIL / MCP connection | Check the current host's `code-review-graph` MCP, Windows PATH, pinned core package and index. Restore connection; rebuild only for a missing/empty/corrupt index. |
| Graph nonempty but stale | Verify watcher registration/running state, branch/source changes; run scoped incremental `update --repo`. Startup availability is not freshness. |
| Graph failure mentioning PyTorch/DLL | Use core `code-review-graph==2.3.9`, without `[embeddings]`; vector embeddings are optional. |
| Hindsight FAIL / connection | Start the configured WSL profile, inspect `/health`, port 9077 and client `self-hosted` API URL. |
| Hindsight FAIL / opt-in or bank 404 | Correct the actual owning worktree's enrollment/mapping and initialize its exact bank once. Restart after config changes. |
| Health PASS but experience absent | Run the real write/read and automatic-capture checks. Check provider sign-in, asynchronous extraction, recall types and session-scoped diagnostic events. |
| Retention fails after final response | It may surface at the next health/turn check; recover provider/API access and verify the next `retain_ok`. Do not claim that response text proves memory saved. |
| Context7 unavailable | Configure personal service access if required, or use official library docs and state the limitation; it is not one of the three startup gates. |
| QA cannot sign in | `AUTH_REQUIRED`; developer signs into the owned private context, then resumes the same child/context. Login recipes are not reusable cookies. |
| Browser isolation or page routing missing | Install the pinned Chrome MCP and proper flags, fully restart. Never use a shared default tab as fallback. |
| Evidence save denied by Chrome | Verify MCP roots/allowed active repository workspace; keep files in owned `qa-artifacts/` and avoid unrestricted path flags. |
| Specialist model unavailable | Change/remove its explicit `model:` override, select an accessible primary model, restart the host. |
| `Task(background: true)` unsupported/foreground only | Enable `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=1` in the launching process and restart the host; verify the tested OpenCode version. |
| Shell write rejected | Use guarded native Edit/Write/ApplyPatch after checkpoint, scoped reads and prepare. Do not bypass the gate with command chains/scripts. |
| Resume has several candidates | Select the real task ID; reconcile source/check fingerprints before continuing. An active old process must park/interrupt its task first. |

After repairing a real failure, `sdlc_health(refresh: true)` reruns native checks.
Repeated health reads do not repair services. Never manufacture PASS, disable
the gate to hide a problem, or borrow another session's receipt.

## Updates and rollback

1. Fetch/check out the reviewed harness source commit. Inspect its changelog/diff
   and dependency version changes; preserve the team's repository docs.
2. Park unfinished tasks and save their exact next action. Stop OpenCode hosts.
3. Back up personal OpenCode/Hindsight configuration separately; the installer
   backs up only the files it owns. Keep secrets local.
4. Install the pinned dependencies if changed, then run `install.ps1`. Reapply
   your available-model override and reconcile personal instructions from backup.
5. Restart services only if their configuration/version changed; restart all
   OpenCode hosts after any runtime/agent/plugin update.
6. Run behavioral tests, real startup checks, and affected memory/browser checks.
   Native service checks remain per-session; no model diagnostics are required
   on a healthy ordinary startup.

Rollback: choose the previous reviewed harness commit and reinstall it, or restore
only the named owned files from a known installation backup. Do not overwrite
provider config with a runtime backup, delete memory/checkpoint state, or mix
runtime files from different revisions. A future checkpoint format migration
would need explicit compatibility instructions; this release adds no such
migration. Fully restart and verify the rollback.

## Build another shareable package

From a committed source checkout:

```powershell
.\tools\opencode-harness\package.ps1 -OutputPath "$env:USERPROFILE\Downloads\opencode-sdlc-harness.zip"
```

The exporter uses `git archive` at `HEAD` (or `-Ref <commit>`), not a filesystem
copy of your user configuration. It includes only the versioned harness,
repository instructions and reviewed context profile. It adds
`PACKAGE-MANIFEST.json` with the commit and per-file hashes, and writes a sibling
`.zip.sha256`. Uncommitted improvements are intentionally not part of a release;
commit reviewed packaging changes before exporting. Choose a new output path
instead of overwriting an earlier release.

Distribution review: confirm there are no auth caches, real keys, `.env`, private
logs/transcripts, databases, browser state or `node_modules`. Configuration
examples contain placeholders and local service addresses only. Do not attach
personal backups or raw Hindsight diagnostics to the developer package.
