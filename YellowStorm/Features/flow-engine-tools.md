---
project: YellowStorm
type: feature
slug: flow-engine-tools
status: active
updated: 2026-06-30 12:00 UTC
source_paths:
  - yellowstorm-adk/src/flow_engine/tools/factory.py
  - yellowstorm-adk/src/flow_engine/nodes/step_tool_scope.py
  - yellowstorm-adk/src/flow_engine/nodes/step_prompt.py
  - yellowstorm-adk/src/flow_engine/tests/test_step_tool_scope.py
  - yellowstorm-adk/src/flow_engine/tests/test_step.py
tags:
  - yellowstorm
  - feature/flow-engine-tools
  - flow-engine
  - adk
  - python
---

# Flow Engine Tools

## Agent Quick Context
- Entry points: `yellowstorm-adk/src/flow_engine/tools/factory.py`, `yellowstorm-adk/src/flow_engine/nodes/step_tool_scope.py`, `yellowstorm-adk/src/flow_engine/nodes/step_prompt.py`
- Runtime flow: `create_tools_for_node()` iterates connector bindings → wraps MCP `call_mcp_tool` into async tool coroutines → returns tool list. `build_prompt_input_context()` resolves document inputs and applies prompt-only path sanitization via `_sanitize_for_prompt()`. `step_prompt.py` sanitizes workspace path metadata (`__playbook_workspace_paths`, `__playbook_default_workspace_path`) and Trigger Context paths before rendering into the LLM prompt. Two-segment workspace paths (e.g. `owner/workspace`) are handled by stripping only the leading ObjectId owner segment.
- Contracts: `create_tools_for_node(bindings)` → list of async tool coroutines
- Invariants: Late-binding pattern to avoid closure bugs in loop-created coroutines. Sanitization is prompt-only — Ceph mount paths, code interpreter paths, runtime tool-mounting paths, and all internal storage references must never be stripped. Two-segment paths (owner/workspace) must only have the ObjectId owner segment stripped, not the workspace name.
- Pitfalls: Simplified skeleton for Phase 3 — full implementation (tool schema validation, error handling, retries) deferred.

## Purpose
Tool factory for flow engine nodes. Creates tool coroutines from node connector bindings. Each binding maps to an MCP tool call. Simplified skeleton for Phase 3 — full implementation follows in later phases.

## Current Implementation
`create_tools_for_node()` iterates connector bindings from the node config and wraps MCP `call_mcp_tool` into async tool coroutines. Uses late-binding (default argument capture) to avoid the classic Python closure-over-loop-variable bug. Returns a list of callable tool coroutines ready for LangGraph node execution.

## Key Files
- `yellowstorm-adk/src/flow_engine/tools/factory.py` — Tool factory with `create_tools_for_node()`
- `yellowstorm-adk/src/flow_engine/nodes/step_tool_scope.py` — `build_prompt_input_context()` with `_sanitize_for_prompt()` for prompt-facing resolved document path sanitization
- `yellowstorm-adk/src/flow_engine/nodes/step_prompt.py` — Prompt rendering sanitizes workspace path metadata and Trigger Context paths via `_sanitize_for_prompt()`
- `yellowstorm-adk/src/flow_engine/tests/test_step_tool_scope.py` — Tests for prompt input context and path sanitization
- `yellowstorm-adk/src/flow_engine/tests/test_step.py` — Tests for prompt-rendered workspace and trigger context path sanitization

## API / Interfaces
- `create_tools_for_node(connector_bindings)` → `list[Callable]` — Creates async tool coroutines from MCP bindings.

## Design Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Late-binding via default args | Prevents closure-over-loop-variable bug | `functools.partial`; factory function per binding |
| Skeleton for Phase 3 | Minimum viable tool creation; iterate later | Full implementation upfront |
| Prompt-only path sanitization | Strips MongoDB ObjectId owner/user segment from resolved document paths in prompts while preserving full internal paths for Ceph mounts and code interpreter | Full path in prompts (noisy), no owner segment in storage (breaks Ceph) |

## Known Pitfalls
- Skeleton implementation — tool schema validation, error handling, and retry logic not yet implemented.
- Late-binding pattern: if the binding signature changes, verify the closure capture still works.
- `_sanitize_for_prompt()` strips owner/user ObjectId prefix for LLM display only — internal storage references (Ceph, code interpreter) must remain full paths. Adding sanitization to internal paths breaks mounting.
- Sanitization now covers three prompt-facing surfaces: (1) Resolved Inputs document paths via `step_tool_scope.py`, (2) playbook workspace path metadata (`__playbook_workspace_paths`, `__playbook_default_workspace_path`) via `step_prompt.py`, (3) Trigger Context paths via `step_prompt.py`. Runtime state and tool mounting continue using raw owner-prefixed paths — do not sanitize these.
- Two-segment paths (e.g. `owner/workspace`) must only strip the 24-char ObjectId owner segment, leaving the workspace name intact. Three+ segment paths strip only the leading segment.

## Recent Changes
### 2026-06-30 12:00 UTC
- Changed: Prompt path sanitization expanded from Resolved Inputs document paths to three prompt-facing surfaces: (1) Resolved Inputs document paths (existing, `step_tool_scope.py`), (2) playbook workspace path metadata (`__playbook_workspace_paths`, `__playbook_default_workspace_path`) in `step_prompt.py`, (3) Trigger Context paths in `step_prompt.py`. Two-segment workspace paths (e.g. `owner/workspace`) are handled by stripping only the leading 24-char ObjectId owner segment. Runtime state and tool mounting continue using raw owner-prefixed paths unchanged.
- Why: Workspace path metadata and Trigger Context paths in LLM-visible prompts still contained raw MongoDB ObjectId owner segments — same noise and minor info exposure as the document paths already sanitized on 2026-06-29.
- Impact: `yellowstorm-adk/src/flow_engine/nodes/step_tool_scope.py` (two-segment path handling), `yellowstorm-adk/src/flow_engine/nodes/step_prompt.py` (workspace paths + trigger context sanitization), `yellowstorm-adk/src/flow_engine/tests/test_step_tool_scope.py`, `yellowstorm-adk/src/flow_engine/tests/test_step.py`. 42 tests passed; reviewer PASS.

### 2026-06-29 12:00 UTC
- Changed: `_sanitize_for_prompt()` in `step_tool_scope.py` now strips the leading MongoDB ObjectId owner/user segment from resolved document input paths before they appear in the LLM prompt (e.g. `owner/workspace/file` → `workspace/file`). Internal storage filepath/workspace paths remain full-length for Ceph mounts and code interpreter. `build_prompt_input_context()` is the caller that applies sanitization to prompt-facing resolved document inputs.
- Why: Full internal paths leak MongoDB ObjectId segments and owner namespace structure into prompts — unnecessary noise for the LLM and a minor information exposure. Prompt-facing paths should reflect user-meaningful workspace-relative paths only.
- Impact: `yellowstorm-adk/src/flow_engine/nodes/step_tool_scope.py` (new `_sanitize_for_prompt` + `build_prompt_input_context` integration), `yellowstorm-adk/src/flow_engine/tests/test_step_tool_scope.py` (new tests). No interface change; product behavior unchanged.
- Invariant: Sanitization is prompt-only — Ceph mount paths, code interpreter paths, and all internal storage references must never be stripped.

### 2026-06-14 22:00 UTC
- Changed: Sibling feature note created — [[playbook-node-skills]] covers task-scoped dropped skills (skill explorer, node badges, execution merge/dedupe). Skills and tools are orthogonal: tools are connector MCP + native agent tools bound at step execution; skills are LLM-level capabilities injected into prompts.
- Why: Cross-reference for future agents working on node-level capability customization.
- Impact: Documentation only.

### 2026-05-31 11:00 UTC
- Changed: Added compiled graph cache (`CompiledGraphCache` in `flow_engine/runtime/graph_cache.py`) — SHA-256 snapshot hashing, 128 max entries, 900s TTL, deduplicated compilation across concurrent requests. `session_id` excluded from cache key to allow cross-session sharing.
- Why: Graph compilation per run was a P1 bottleneck; caching by snapshot hash fixes it without changing tool semantics.
- Impact: `yellowstorm-adk/src/flow_engine/runtime/graph_cache.py`, `yellowstorm-adk/src/flow_engine/tests/test_graph_cache.py`, `yellowstorm-adk/src/flow_engine/grpc_service.py` (uses cache in compose).

### 2026-05-20 22:00 UTC
- Changed: `src/langgraph_engine/` deleted entirely — all code moved to `src/flow_engine/legacy/`. The previously documented shims (`langgraph_engine/playbook_tool_factory.py`, `langgraph_engine/artifact_routing.py`) no longer exist. `playbook_tool_factory.py` is now at `flow_engine/legacy/playbook_tool_factory.py`. All imports updated from `src.langgraph_engine.*` to `src.flow_engine.legacy.*`.
- Why: Final migration step — `langgraph_engine` package fully removed from codebase.
- Impact: `flow_engine/legacy/` (all former langgraph_engine files), `flow_engine/legacy_runtime.py`, `tests/flow_engine_legacy/`. 140 migration-affected tests pass; zero regressions.

### 2026-05-20 17:30 UTC
- Changed: LangChain playbook tool factory ownership moved to `flow_engine/tools/langchain_factory.py`. Legacy `langgraph_engine/playbook_tool_factory.py` is now a compatibility shim re-exporting from `flow_engine.tools.langchain_factory`. Artifact routing moved to `flow_engine/runtime/artifact_routing.py` (legacy `langgraph_engine/artifact_routing.py` is a shim). `flow_engine/nodes/step.py` now imports `src.flow_engine.tools.create_langchain_tools` directly.
- Why: Flow engine is the canonical runtime; langgraph_engine is being drained. Shim layer preserves backward compatibility.
- Impact: `flow_engine/tools/langchain_factory.py` (canonical), `flow_engine/runtime/artifact_routing.py` (canonical), `langgraph_engine/playbook_tool_factory.py` (shim), `langgraph_engine/artifact_routing.py` (shim), `flow_engine/nodes/step.py` (import updated).
- Invariant: Langgraph_engine shims must NOT contain new logic — they re-export only. All new tool factory and artifact routing work goes to `flow_engine/`.

### 2026-05-19 23:45 UTC
- Changed: Flow-engine step nodes now derive tool scope from resolved node inputs instead of using a static scope. `create_langchain_tools()` accepts and forwards `workspace_context`, `input_files`, `documents_by_port`, `code_interpreter_files`, `output_ports`, and `workspace_context_mode`. Prompt-only filenames are sanitized so Ceph S3 storage names are not exposed to the LLM. Opaque downstream document refs (port-bound references from upstream nodes) are hydrated from `brain_context` when possible; if a port-bound ref cannot be resolved, the node no longer falls back to broad workspace mounting.
- Why: Tool scope must reflect the actual documents and files available to the step at runtime, not a static workspace-wide default. Sanitizing storage filenames prevents leaking internal naming conventions into prompts. Hydrating opaque refs makes port-bound documents accessible to tools; removing the broad fallback prevents mounting unrelated workspace content.
- Impact: `step_tools.py`, `playbook_tool_factory.py` (tool scope + filename sanitization + doc ref hydration). Tests added for: direct documents, opaque refs hydration from `brain_context`, and unresolved opaque refs (no fallback mount). No interface change; product behavior unchanged.

### 2026-05-17 23:45 UTC
- Changed: Flow engine step nodes now use `step_tools.py` for tool binding and bounded execution. `create_langchain_tools()` (in `playbook_tool_factory.py`) replaced the skeleton `factory.py` as the primary tool creation path — builds connector MCP tools, platform tools, and native agent tools as LangChain `StructuredTool` objects. `run_step_with_tools()` implements bounded tool-call loop (MAX_TOOL_ITERATIONS=10). Original `tools/factory.py` skeleton remains but is no longer the active path for step node execution.
- Why: Real agent tool execution requires structured tool definitions, OpenAI-compatible schemas, and bounded iteration — the Phase 3 skeleton was insufficient.
- Impact: `step_tools.py` (new), `step.py` (updated dispatch), `playbook_tool_factory.py` (updated). No changes to `tools/factory.py`.

### 2026-05-13 23:30 UTC
- Changed: Created tool factory skeleton with late-binding MCP tool coroutine creation.
- Why: Phase 3 of PLAYBOOK_REWRITE — provide tool infrastructure for flow engine nodes.
- Impact: `yellowstorm-adk/src/flow_engine/tools/factory.py` (new)

## Related Notes
- [[playbook-flow]] — Parent feature (flow engine runtime)
- [[flow-engine-mcp]] — MCP client used by tool factory
- [[flow-engine-action]] — Peer node type (deterministic actions)
- [[adk-architecture]] — Python ADK runtime architecture
- [[playbook-node-skills]] — LLM-level skill capabilities (orthogonal to tools)
