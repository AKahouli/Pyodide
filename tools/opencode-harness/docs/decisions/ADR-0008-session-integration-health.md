---
id: ADR-0008
status: accepted
scope: per-session-integration-health
source_paths:
  - tools/opencode-harness/runtime/plugins/sdlc.js
  - tools/opencode-harness/runtime/lib/sdlc-core.mjs
  - tools/opencode-harness/runtime/lib/startup-health.mjs
  - tools/opencode-harness/runtime/lib/memory-settings.mjs
  - tools/opencode-harness/tests/startup-plugin.test.mjs
reviewed_at: 2026-10-13
---

# Verify graph, memory and checkpoint availability per session

## Decision

Every native OpenCode session/process checks its actual worktree integrations.
Checkpoint health requires transactional write/read verification. Graph health
requires a connected host MCP and successful nonempty scoped statistics. Hindsight
requires a healthy API/database, native workspace/bank diagnostics, authenticated
bank read and enabled capture configuration. Pending/failed checks block edits and
mutating shell commands while allowing diagnosis and blocker recording.

The health tool reports actual receipts; its arguments cannot declare PASS.
Failure reporting includes system context, stderr and a UI toast when available.
Primary agents report a concise startup status; children report to their caller.
Missing policy/store support is diagnosed instead of silently returning no hooks.
Missing/unloadable plugin tools must be reported through global instructions.

Receipts are isolated by canonical root, session and process owner in the existing
checkpoint JSON store. Same-session task generations retain verified startup;
new processes/sessions and resume destinations establish their own health. Retry
generations fence late probe responses and native errors. Current scoped tool
observations are required again after explicit health refresh.

Use the core graph MCP package for structural navigation; optional embeddings are
not a required startup dependency. No startup graph rebuild, extra graph server,
daemon restart, memory opt-in expansion or new persistent database table is added.

## Rationale

Configuration and instructions alone did not establish integration health after
switching directories. Explicit probes expose unavailable services and wrong roots
without silently substituting a different repository/session's context. Shared
Hindsight configuration precedence is respected, including worktree inheritance.

## Verification and limits

Focused tests exercise store concurrency, settings/opt-in, service/auth failures,
wrong roots, empty graph indexes, capture-disabled settings, visible failures and
refresh races. Native integration passed with two independent OpenCode processes,
including a frontend-subdirectory launch: scoped graph statistics, actual memory
bank access and checkpoint persistence all passed with separate session receipts.

Graph readiness establishes availability, not working-tree freshness or complete
semantic coverage. Hindsight bank reads/capture configuration do not prove future
asynchronous extraction. Session-tagged capture failures in a bounded diagnostic
tail are reported during later checks; final-turn background failures may be
reported only on the next interaction. Health is not an OS sandbox for trusted
project scripts or unrelated external tools.
