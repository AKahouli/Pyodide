---
name: Explore Codebase
description: Navigate and understand codebase structure using the knowledge graph
---

## Explore Codebase

Use code-review-graph MCP tools for code-level exploration and Obsidian MCP tools for architecture context and module boundaries.

### Phase 1: Vault Context (always first)

For every task, search the Obsidian vault for relevant architecture context, module boundaries, and feature notes before touching code.

1. Use `obsidian_vault` with `action="fragments"` and `strategy="semantic"` to retrieve contextually relevant sections. (This is the primary search method — the `search` action uses basic matching and is less effective.)
2. Use `obsidian_vault` with `action="read"` to pull full notes when fragments indicate high relevance.

### Phase 2: Code Graph

Use the code-review-graph MCP tools to explore code structure.

1. Run `list_graph_stats` to see overall codebase metrics.
2. Run `get_architecture_overview` for high-level community structure.
3. Use `list_communities` to find major modules, then `get_community` for details.
4. Use `semantic_search_nodes` to find specific functions or classes.
5. Use `query_graph` with patterns like `callers_of`, `callees_of`, `imports_of` to trace relationships.
6. Use `list_flows` and `get_flow` to understand execution paths.

### Phase 3: File Search (fallback)

Use Glob, Grep, and Read for direct file inspection when graph or vault search is insufficient.

### Tips

- Start broad (vault context → graph stats → architecture) then narrow down.
- Use `children_of` on a file to see all its functions and classes.
- Use `find_large_functions` to identify complex code.
- Vault notes are the canonical long-term memory. Trust them over assumptions.

## Token Efficiency Rules
- ALWAYS start with `obsidian_vault` semantic search and `get_minimal_context(task="<your task>")` before any other tool.
- Use `detail_level="minimal"` on all graph calls. Only escalate to "standard" when minimal is insufficient.
- Target: complete any review/debug/refactor task in ≤5 tool calls and ≤800 total output tokens.
