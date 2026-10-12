# Global agent rules

- External library, framework, SDK, or CLI questions: use the Context7 MCP (`resolve-library-id`, then `query-docs` scoped to one concept) before answering from memory. Load the `context7-mcp` skill for the full recipe. Not for business logic, refactoring, or code review.
- Keep replies short and factual. Give a concise update at a real milestone, blocker, or background launch; avoid tool-by-tool narration and restating the request.
- Read files by section or line range. Reuse current session evidence instead of re-reading unchanged material.
- Prefer independent tool calls and bounded subagent tasks in parallel. Native Task `background: true` returns immediately and notifies on completion when enabled; continue unrelated work and do not poll or duplicate the task.

## Questions and autonomy

- The primary agent owns questions to the user; specialists return the exact missing information to it. First inspect available context. Ask only when an unresolved choice materially changes the outcome, scope, access, or acceptance criteria. Bundle related questions; use a stated, reversible default for minor details. Continue independent work while a necessary answer is pending.
- Within the agreed request, perform implementation, checks, fixes, and delegation without asking for confirmation at each step. Honor actual permission gates and user-requested stopping points. New user feedback steers the active task; it does not reset discovery or settled decisions.
- For work with multiple substantial, independently testable phases, ask once at kickoff: finish end to end or pause after each completed, testable phase. Reuse a choice already confirmed for the current task; do not turn one task's answer into a permanent preference. End to end means continue through all agreed phases with concise milestone updates. Phase pauses mean deliver the completed phase's evidence and testing instructions, then wait for the user's decision before starting the next phase.

## CRG: graph-first code work

- Start a new code investigation with `get_minimal_context_tool(task=..., repo_root=...)`. Reuse a caller's current scoped graph evidence instead of repeating this in every specialist. Pass the active repository/worktree's absolute `repo_root` to every repository-scoped graph call.
- Load `crg-navigation` for task-specific recipes. Prefer targeted queries, `detail_level="minimal"`, bounded results, and depth 1-2. Aim for about five graph calls / 800 output tokens per investigation, expanding only when correctness requires it.
- If the graph is missing/stale, use focused source search immediately. Refresh incrementally when needed for a remaining impact question and check the result; read-only subagents report refresh needs. Recheck after branch switches or external edits; matching HEAD does not establish working-tree freshness.
- The graph narrows scope; source and executable tests remain authoritative. Empty results, unresolved calls, partial builds, dynamic dispatch, and serialized boundaries require targeted source verification. If CRG is unavailable or cannot answer, use focused Grep/Glob/Read and record the limitation in the handoff.
- Refresh after meaningful code edits before impact/review analysis unless freshness is established. Supply the actual review base and changed files; do not default to `HEAD~1` for uncommitted work or a whole-branch review.
- Skip CRG for pure prose, trivial text edits, and git-only chores. Do not run architecture listings, embeddings, or full rebuilds routinely. Keep graph data isolated per repository/worktree.
- The shared `crg-daemon` manages watching via `~/.code-review-graph/watch.toml`; MCP servers serve queries without `--auto-watch`. Do not add duplicate edit-update hooks. Only configured paths are watched, and daemon liveness does not prove graph freshness; retain explicit-root and freshness checks.
