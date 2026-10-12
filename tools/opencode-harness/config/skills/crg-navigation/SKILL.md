---
name: crg-navigation
description: Graph-first code exploration, debugging, impact analysis, review, and refactoring across repositories and git worktrees, using bounded CRG queries followed by source verification.
---

# CRG navigation

Tool names below omit the `code-review-graph_` prefix. Use the installed tool schema as authority when upstream documentation differs.

## Entry and freshness

- Start new code investigations with `get_minimal_context_tool(task=..., repo_root=<absolute active worktree>)`. Reuse current scoped graph evidence supplied by the caller instead of repeating the same entry query. This returns readiness, summary, risk, and suggestions, not source snippets.
- Pass the same explicit root to every repository-scoped call. Never share one graph data directory across unrelated repositories/worktrees.
- The shared `crg-daemon` watches paths configured in `~/.code-review-graph/watch.toml`; MCP servers only serve queries. Do not add duplicate edit hooks or `--auto-watch`. Daemon liveness alone does not establish graph freshness.
- On `not_ready`, use targeted source search immediately. The build agent refreshes incrementally when needed for an unresolved impact question; read-only agents request refresh from their caller. Check `ok`/`partial`/`error` before relying on results. A matching HEAD does not prove uncommitted edits are indexed.
- Incremental update is the default. Use full rebuild only for a concrete indexing problem. `postprocess="minimal"` refreshes signatures/FTS but does not recompute flows/communities; use full postprocessing when those analyses matter.
- Skip graph calls for prose and git-only chores. Missing indexing, unsupported/static-invisible relationships, or an unavailable MCP justify targeted file-search fallback; state the limitation.

## Locate and understand

1. `semantic_search_nodes_tool(query=<symbol or feature>, limit=5, detail_level="minimal")`. Without matching embeddings it falls back to keyword/FTS search; do not embed routinely.
2. `query_graph_tool(pattern=<callers_of|callees_of|imports_of|importers_of|tests_for|children_of|file_summary>, target=<name, qualified name, or file path>, detail_level="minimal", max_results=10)` as needed. There is no `dependents_of` pattern in the exposed schema.
3. Read only the located implementation/test ranges. Follow exact call sites when ambiguity matters; distinguish bound calls from unresolved bare-name matches.

## Change impact and debugging

- Trace a suspect symbol's callers/callees before editing; reproduce bugs with executable checks.
- `get_impact_radius_tool(changed_files=[<repo-relative file paths>], repo_root=..., max_depth=2, detail_level="minimal")` accepts files, not function names.
- Request `get_affected_flows_tool` only if execution paths remain unclear, then `get_flow_tool` for one relevant path. These are static call chains, not runtime traces.
- For recent regressions, `detect_changes_tool` with the relevant base/files can narrow suspects. Empty impact or flow results do not establish safety, especially across REST/gRPC/queues or dynamic dispatch.

## Review

1. Refresh meaningful edits before reviewing unless freshness is established.
2. `detect_changes_tool(repo_root=..., base=<explicit revision>, changed_files=[<scoped paths>], detail_level="minimal", max_results=10)`.
3. Use `base="HEAD"` for uncommitted work; use the actual merge-base commit for branch review. Do not blindly use the `HEAD~1` default.
4. Query callers/tests for high-risk symbols. Request `get_review_context_tool` snippets or affected-flow details only where the first analysis is insufficient.
5. Read source and tests, verify both sides of serialized boundaries, and run executable checks. Risk scores and graph-derived test links guide review; they do not prove correctness or coverage.

## Refactoring and architecture

- Before a rename, inspect callers/impact and `refactor_tool(mode="rename", old_name=..., new_name=...)`. The apply tool uses exact string replacements, not guaranteed semantic renaming; inspect a dry run, then verify the final diff and tests. Apply only when the agent is authorized to edit.
- Dead-code and refactoring suggestions are candidates, not deletion approvals; check entry points, dynamic references, and public consumers.
- For architecture questions only, start with `get_architecture_overview_tool(detail_level="minimal")`, then inspect one relevant community. Hubs/bridges highlight structural concentration, not proven production criticality.

## Budget and handoff

Aim for about five calls / 800 graph-output tokens per investigation, not a hard safety limit. Prefer minimal detail, bounded results, and depth 1-2; expand only to answer a remaining question. Do not run every recipe or repeat overlapping summaries.

Handoffs include the absolute root, review base, changed files, graph freshness/limitations, located symbols/paths, and checks already run. Cross-repository search uses registered aliases via `repos`, not paths; verify each result in its owning repository.
