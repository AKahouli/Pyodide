---
id: ADR-0011
status: accepted
scope: harness-enforcement-and-follow-up
source_paths:
  - AGENTS.md
  - tools/opencode-harness/config/AGENTS.md
  - tools/opencode-harness/config/agents/
  - tools/opencode-harness/runtime/plugins/sdlc.js
  - tools/opencode-harness/runtime/lib/sdlc-core.mjs
  - tools/opencode-harness/tests/startup-plugin.test.mjs
reviewed_at: 2026-10-13
---

# Keep persistent protection and use native policy with advisory integrations

## Decision

Graph/Hindsight failure or pending health never blocks coding. Automatic checks,
session-specific receipts and visible failure/recovery reporting remain. Agents
use focused source/search/tests without graph context and Git docs/checkpoints
without memory. Do not claim graph coverage or memory persistence when unavailable.

Remove the edit health gate and successful post-tool integration revalidation.
Startup/explicit refresh already verifies the graph and actual mapped memory bank.
Remove the duplicate diagnosed-bank settings resolver. Native tool errors and
session-tagged asynchronous capture errors still update advisory reports.

Keep per-worktree transactional SQLite checkpoints, process/session ownership,
in-flight edit recovery, task baselines, read evidence and exact file claims.
Actual checkpoint storage/ownership failure or stale/unprepared targets still
block native edits. Native permissions govern shell commands and specialist tools.
Broad defaults precede specific overrides under native last-match semantics.
Authored source/document changes use native edit tools; arbitrary scripts are
outside these read/ownership guarantees and must respect shared runtime resources.

Workflow and response policy belongs in repository/global `AGENTS.md` and native
agent Markdown. The plugin injects compact state/observations, not repeated workflow
instructions. Preserve architecture approval, risk-based review and private browser
isolation/authentication rules.

Every human reply ends with a clear **Follow-up:** actor, next action/location and
expected result or test. Proposals explicitly remain proposals; authorized ongoing
work continues without routine confirmation. Abstract lessons or repeated settled
constraints do not replace actionable follow-up. Automatic experience capture is
separate; the footer does not prove a memory write succeeded.

## Rationale

The user reported multiple false blockers from custom enforcement and explicitly
approved simplifying the harness while retaining checkpoints and parallel-session
protection. Context accelerators must not stop implementation when source and tests
can establish behavior. Their unavailable state must remain visible.

The previous mandatory experience sentence encouraged vague constraint restatements.
The user requested explicit, clear follow-up after each interaction.

## Verification and limits

The user approved this policy explicitly on 2026-10-13; the bounded agent-execution
review passed and all 44 current Windows harness tests passed.
Native OpenCode CLI 1.18.34 also resolved all seven specialist configurations:
health/checkpoint/resume/diff permissions allow their tools, while the unconfigured
tool default remains deny. This validates native rule ordering without model calls.

Regression checks prepare and perform native Edit/Write/ApplyPatch with both graph
and Hindsight failed, retain failure reports and reject a parallel task claiming
the same file. Missing policy still blocks native edits; command execution follows
native permissions. Successful Hindsight diagnosis triggers no extra HTTP probe.
Existing tests cover independent processes/worktrees, WAL initialization, interrupted
edits, stale evidence, baselines and resumed ownership. Automatic bank and graph
checks retain scoped identity/authentication/timeouts and capture error coverage.

Native startup probes remain bounded external reads; they can add startup latency.
Markdown guides behavior but cannot guarantee semantic reuse or response quality.
Native permissions and shell trust limits remain as recorded in ADR-0010.

## Superseded scope

Supersede graph/memory edit blocking in [ADR-0008](ADR-0008-session-integration-health.md)
and [ADR-0009](ADR-0009-native-startup-readiness.md), preserving their accepted history,
automatic startup checks and separate session receipts. Preserve the native shell
decision in [ADR-0010](ADR-0010-native-shell-permissions.md) and persistent protection
in [ADR-0005](ADR-0005-task-checkpoints-and-reuse-gates.md).
