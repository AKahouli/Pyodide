@AGENTS.md

## CRG

Follow the global CRG rules and load the personal `crg-navigation` skill for code investigations. Start with minimal context and an explicit absolute active worktree root; narrow scope with the graph, then verify source and tests.

The shared multi-repository daemon maintains configured graphs. Do not add per-session watchers or duplicate update hooks; verify freshness before relying on results. Use scoped source-search fallback for configuration, unindexed files, or relationships static analysis cannot model.
