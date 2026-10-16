---
id: ADR-0009
status: accepted
scope: native-session-startup-readiness
source_paths:
  - tools/opencode-harness/runtime/plugins/sdlc.js
  - tools/opencode-harness/runtime/lib/startup-health.mjs
  - tools/opencode-harness/runtime/lib/memory-settings.mjs
  - tools/opencode-harness/tests/startup-plugin.test.mjs
  - tools/opencode-harness/tests/memory-settings.test.mjs
reviewed_at: 2026-10-13
---

# Complete startup readiness without model tool round trips

## Decision

Supersede ADR-0008's mechanism requiring model-driven scoped graph statistics,
Hindsight diagnosis and repeated health inspection. Preserve its requirement to
verify all three integrations in the actual worktree and visibly report failures.

The plugin automatically verifies the host graph MCP connection and reads the
scoped index without mutation. It derives the Hindsight bank using environment,
file and OpenCode harness configuration, current/main worktree mappings and
initial-bank overrides, then checks API readiness, authenticated bank access and
capture configuration. Each session separately verifies checkpoint persistence.
Do not instantiate another memory plugin, seed banks or rebuild graph indexes.

Concurrent in-flight service probes may coalesce within one process and canonical
root. Each session receives its own results and checkpoint receipt. No persistent
cross-session cache or cross-process/worktree health borrowing is introduced.
Explicit refresh fences stale results and reruns native checks.
Host API requests use the launch directory; graph and memory ownership use the
worktree selected by the installed Hindsight adapter. SQLite driver selection
uses the actual runtime version rather than a compatibility global.
Concurrent fresh checkpoint stores negotiate WAL with a monotonic five-second
lock budget, retry only SQLite busy/locked errors, and initialize the existing
schema transactionally. Failed connection handles close before retrying.

Inject the native result into context. Mandatory model-driven statistics,
`hindsight_diagnose` and health calls are removed from startup instructions.
`sdlc_health` remains available for diagnosis and explicit refresh after recovery.
Failures retain visible recovery actions and block dependent edits. Normal
task-specific scoped graph context and freshness checks remain required.

Expose the loaded runtime version in startup/health output. Installation requires
restarting the entire OpenCode host; a new chat in an old host cannot reload it.

## Context and rationale

The user reported startup failures and repeated calls delaying new sessions.
Depending on additional model calls created avoidable round trips and allowed
startup to remain pending despite healthy integrations. Bank derivation belongs
in native configuration resolution, with path approval before overrides and no
reverse lookup of final bank aliases.

## Verification and limits

Focused settings tests cover default and fixed banks, environment/file/harness
precedence, linked worktrees, longest-prefix mappings, capture/credential overrides,
renamed banks, opt-in enforcement and rejected unknown placeholders. Startup tests
must cover independent session receipts, bounded native requests, concurrent probe
coalescing, visible failures, explicit refresh and loaded-version reporting.
Verification passed in two real OpenCode CLI processes, one launched from the
root and one from the frontend directory, with independent receipts and zero
model diagnostic calls. The desktop Node 24.15 runtime also read the real graph
successfully with a compatibility `Bun` global present.

Readiness verifies availability and configuration, not semantic completeness,
working-tree freshness or future asynchronous memory-write success. Session-tagged
capture failures are checked during later health/turn checks; a final-turn failure
may only be surfaced on the next interaction. Trusted scripts remain outside an
OS sandbox. Missing/unloadable plugins must still be reported through instructions.

## Superseded record

[ADR-0008](ADR-0008-session-integration-health.md), specifically its model-driven
startup probes. Its accepted history remains unchanged.
