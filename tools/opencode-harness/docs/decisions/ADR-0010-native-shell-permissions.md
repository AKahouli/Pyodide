---
id: ADR-0010
status: accepted
scope: agent-shell-permissions
source_paths:
  - tools/opencode-harness/runtime/plugins/sdlc.js
  - tools/opencode-harness/config/opencode.example.json
  - tools/opencode-harness/config/agents/
  - tools/opencode-harness/tests/startup-plugin.test.mjs
reviewed_at: 2026-10-13
---

# Use native OpenCode permissions for shell execution

## Decision

Remove the custom shell allowlist and shell health gate. Native OpenCode command
permissions in configuration and agent Markdown are the authority for shell
execution. The plugin must not reject runtime startup, log inspection, tests or
builds because a graph, memory or checkpoint integration is unavailable.
Restricted specialists retain their existing permissions and ask the primary
agent to execute authorized commands outside their role.

Keep automatic integration checks and visible failure reports, durable checkpoints,
resume, read evidence and transactional file claims for native edit tools. Agents
must use those edit tools for authored source/document changes and honor resource
ownership when running scripts in parallel sessions.

## Context and rationale

The user reported repeated workflow blockers, most recently for
`scripts/start-local.ps1`, and challenged the complexity of custom enforcement.
The regex allowlist duplicated native permissions and rejected ordinary Windows
runtime commands. Replacing it with more exceptions would perpetuate the problem.

Native instructions describe workflow and native permissions control commands.
Durable checkpoint and concurrent ownership state still require executable support;
Markdown does not provide transactional file reservations.

## Verification and limits

Plugin regression checks pass PowerShell startup, log reads, builds and Git
inspection through the before hook without modifying arguments while graph health
fails. The missing-policy fallback also leaves shell permission handling to
OpenCode while blocking native source edits. Existing checkpoint, worktree and
parallel-session tests verify the retained protections.

These hook tests do not launch the project's runtime or verify its worker logs.
The reported `scripts/start-local.ps1` is absent in the inspected current checkout;
the runtime agent must establish its actual working directory and script path.
Native permissions can still deny a command for a restricted role.

Trusted scripts can modify source or shared runtime resources. The plugin cannot
enforce read evidence/file claims on arbitrary shell writes and is not an OS
sandbox; native permission rules and agent instructions govern those paths.

## Superseded scope

Supersede the shell restrictions in [ADR-0005](ADR-0005-task-checkpoints-and-reuse-gates.md)
and any shell health gating implied by [ADR-0008](ADR-0008-session-integration-health.md).
Preserve their accepted history and the automatic startup mechanism in
[ADR-0009](ADR-0009-native-startup-readiness.md).
