---
name: graphify-navigation
description: Graph-first code exploration, debugging, impact analysis, and review across repositories and git worktrees, using bounded graphify CLI queries followed by source verification.
---

# Graphify navigation

The graphify CLI answers against `graphify-out/graph.json` of the current
directory. Treat upstream help output as authority when it differs from this
skill.

## Entry and freshness

- Start new code investigations with `graphify query "<question>" --budget 1500` scoped to one concern. Reuse current graph evidence supplied by the caller instead of repeating the same query.
- Graph availability is advisory, never a coding gate. On missing/empty/stale output, use targeted source search and tests immediately. Read-only agents request refresh from their caller; the build agent may run `graphify update .` (incremental, code-only, no LLM) when an unresolved impact question needs it.
- Freshness is owned by the graphify git hooks: post-commit/post-checkout/post-merge/post-rewrite rebuild in the background, so a query right after a commit can briefly see the old graph. After `git pull` or a merge, run `graphify update .` explicitly. `graphify hook status` verifies the hooks are installed in this clone.
- `graphify update . --force` is only for refactors that deleted code (or `GRAPHIFY_FORCE=1`). Verify hooks with `graphify hook status` before assuming automatic refresh.
- Skip graph calls for prose and git-only chores. Missing indexing or relationships static analysis cannot model justify targeted file-search fallback; state the limitation.

## Locate and understand

1. `graphify query "<question>" --budget N` (BFS by default, `--dfs` optional, `--seed <node>` to start from a known symbol, `--context <edge-context>` to filter relations).
2. `graphify explain "<symbol>"` inspects one node's neighbors (top 20 connections; `--all` for everything).
3. `graphify path "A" "B"` traces how two things connect. Read only the located implementation/test ranges afterwards; every edge is tagged `EXTRACTED` (explicit in source) or `INFERRED` (resolved), so verify `INFERRED` edges in source before relying on them.

## Change impact and debugging

- `graphify affected "<symbol>" --depth 2` reverse-traverses impacted nodes; `--relation` narrows edge kinds.
- Trace a suspect symbol's callers with `graphify explain` before editing; reproduce bugs with executable checks.
- Exit codes: `0` answer, `3` ambiguous name (candidates are listed — retry with the exact candidate), `4` no matching node (fall back to source search).

## Review

1. Reuse established graph freshness. If stale/unavailable, review the scoped diff, source and tests directly; run `graphify update .` only for an unanswered impact question.
2. Use `graphify affected` / `graphify path` for high-risk symbols, then read source and tests, verifying both sides of serialized boundaries. Graph answers guide review; they do not prove correctness or coverage.

## Architecture questions only

- `graphify god-nodes --top 10` lists structural hubs; communities appear in `GRAPH_REPORT.md`. Concentration highlights structure, not proven production criticality.

## Budget and handoff

Aim for about five CLI calls / 800 graph-output tokens per investigation, not a hard limit. Prefer `--budget` caps and expand only to answer a remaining question. Do not run every recipe or repeat overlapping queries.

Handoffs include the absolute worktree root, review base, changed files, graph freshness/limitations, located symbols/paths, and checks already run. Queries default to the current directory's `graphify-out/`; pass `--graph <path>` when querying another worktree's graph and never mix unrelated repositories into one answer.
