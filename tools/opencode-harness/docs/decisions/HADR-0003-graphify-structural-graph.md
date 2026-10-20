---
id: HADR-0003
status: proposed
scope: graphify-structural-graph-and-memory-removal
source_paths:
  - tools/opencode-harness/runtime/lib/startup-health.mjs
  - tools/opencode-harness/runtime/plugins/sdlc.js
  - tools/opencode-harness/setup.ps1
  - tools/opencode-harness/setup-config.mjs
  - tools/opencode-harness/config/opencode.example.json
  - tools/opencode-harness/config/skills/graphify-navigation/SKILL.md
reviewed_at: 2026-10-20
---

# Replace code-review-graph and Hindsight with graphify

The user requested removal of the code-review-graph MCP integration and the
Hindsight experience-memory integration from the harness, replacing the
structural graph with graphify and including the graphify git hook so graph
data stays fresh.

## Decision

Use the local graphify CLI (PyPI package `graphifyy`, command `graphify`) as
the structural code graph. Queries run through read-only shell commands
(`graphify query/path/explain/affected`) against the per-worktree
`graphify-out/graph.json`; agents receive narrow native bash permission
allows for exactly those commands and the `graphify-navigation` skill replaces
`crg-navigation`. No graphify MCP server is registered: OpenCode is an
instruction-file platform in graphify's integration model, and an MCP server
would pin one absolute graph path across worktrees. The `code-review-graph`
MCP entry, its daemon/watcher setup and its tool permissions are removed.

Graph freshness is owned by the graphify git hooks installed per clone
(`graphify hook install`: post-commit, post-checkout, post-merge,
post-rewrite, plus the graph.json merge driver) and by an explicit
`graphify update .` after pulls/merges. Setup installs the persistent
`uv tool install graphifyy` (hooks re-run `graphify`, which an ephemeral
`uvx` cache cannot guarantee), builds an initial code-only graph when
`graphify-out/graph.json` is missing, installs the hooks and verifies
`graphify hook status` reports the hooks installed.

Remove Hindsight entirely: the plugin memory probe, `memory-settings.mjs`,
`hindsight.example.json`, the memory actions in `setup-config.mjs`, the
setup WSL/daemon/bank workflow, Hindsight permissions in agent configs and
the HINDSIGHT documentation set. Experience knowledge returns to reviewed
Git documentation and local task checkpoints only.

Startup health keeps the native no-model-round-trip mechanism: the plugin
probes `graphify-out/graph.json` (bounded head read: `graph.schema_version`,
non-empty nodes) and `graphify-out/.graphify_root` (canonical worktree
ownership) plus transactional checkpoint persistence, and reports `graph`
and `checkpoints` per session. A failing `graphify` shell query observed by
the plugin updates the advisory graph report. Health stays availability-only
and advisory per [ADR-0008](ADR-0008-session-integration-health.md),
[ADR-0009](ADR-0009-native-startup-readiness.md),
[ADR-0010](ADR-0010-native-shell-permissions.md) and
[ADR-0011](ADR-0011-advisory-integrations-and-native-policy.md): hooks own
freshness, probes never rebuild the graph, and failures never block coding.

## Rationale

Graphify covers the same structural-navigation need with a local
deterministic tree-sitter pipeline, per-worktree output and documented
git-hook freshness, replacing both a daemon-based MCP server and a second
memory service the user no longer wants. One tool with one freshness story is
simpler to operate than an MCP server plus watcher plus memory daemon.

## Superseded scope

Supersedes the Hindsight capture half of [ADR-0001](ADR-0001-agent-knowledge.md)
(Git documentation remains authoritative) and, on acceptance, withdraws the
proposed [HADR-0002](HADR-0002-durable-experience-recall.md). ADR-0008's
three-service wording is narrowed to graph/checkpoints by this record while
its accepted history remains unchanged.

## Verification and limits

Focused tests cover the bounded index probe (schema, nodes, root ownership,
truncated/large files), plugin receipts with graph/checkpoints only, hook
installation status verification and idempotent config merges. The real
repository graph passed the probe end to end and read-only CLI queries
returned exit code 0 with scoped answers. Readiness establishes availability,
not working-tree freshness: hooks rebuild in the background, so a query
immediately after a commit can briefly see the old graph and pulls/merges
need the explicit update. Ambiguous node names are refused with candidates
(exit 3) rather than guessed.
