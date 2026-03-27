# Playbook ADK Runtime

## Scope

This document covers the Playbook execution runtime inside `Yellowstorm-adk`.

Main implementation areas:

- `src/grpc_server/chatbot_servicer.py`
- `src/langgraph_engine/workflow_service.py`
- `src/langgraph_engine/graph_builder.py`
- `src/langgraph_engine/step_executor.py`
- `src/langgraph_engine/state.py`
- `src/langgraph_engine/playbook_queue.py`
- `src/langgraph_engine/graph_cache.py`
- `src/langgraph_engine/checkpointer.py`

## Runtime Responsibilities

The ADK is responsible for:

- receiving gRPC execution requests
- building or reusing a dynamic LangGraph
- executing tasks with tools or direct LLM calls
- handling replay-aware execution modes
- suspending for human input when required
- resuming interrupted workflows
- streaming step updates back to the backend

## Workflow Entry Points

The primary workflow path is:

- `ChatbotServicer.RunPlaybookWorkflow`

Related paths:

- `ResumePlaybookWorkflow`
- `RunStep`
- `ResumeStep`
- `StopPlaybookWorkflow`
- `EvaluateSemanticMatch`

## Dynamic Graph Construction

`graph_builder.py` builds a graph from the playbook DAG.

Behavior:

- one graph node per task
- edges derived from the playbook edges
- multiple entry tasks are handled through a synthetic parallel start node
- completion is coordinated through a final node

## Task Node Lifecycle

Each task node broadly does the following:

1. emit `in_progress`
2. run clarification gate if enabled
3. interrupt before execution if approval is required
4. gather dependency context
5. build prompts from task, agent, query, and workspace context
6. choose live or replay execution mode
7. execute
8. interrupt after execution if review is required
9. emit final result or suspension

## Replay Modes

Current execution modes include:

- `live`
- `replay_strict`
- `replay_flex`
- `replay_adaptive`

These are implemented in the runtime so the backend can keep one consistent orchestration model while switching task behavior.

## HITL Semantics

The runtime uses LangGraph `interrupt(...)` for:

- clarification
- approval before execution
- review after execution

Special case:

- `approved = false` plus reason `__SKIP_STEP__` is treated as a skipped task instead of a failure

## Queue and Cancellation

`playbook_queue.py` stores:

- `thread_id -> queue`
- `thread_id -> task`

This supports:

- live step-update streaming
- workflow cancellation by thread id
- clean stream shutdown on stop

## Checkpointing and Resume

Resume behavior depends on:

- SQLite checkpoint persistence
- thread graph retention

Without those two pieces, a suspended workflow cannot be resumed with full LangGraph continuity.

