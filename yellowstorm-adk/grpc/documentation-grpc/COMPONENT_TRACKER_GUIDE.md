# Component Tracker Guide

How the `ComponentTracker` manages `add` vs `update` actions for manager and delegated agents.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Internal State](#internal-state)
4. [Decision Logic](#decision-logic)
5. [Manager Agent Flow](#manager-agent-flow)
6. [Delegated Agent Flow](#delegated-agent-flow)
7. [Plan Component Flow](#plan-component-flow)
8. [Components That Bypass the Tracker](#components-that-bypass-the-tracker)
9. [The Manager Return Problem and Fix](#the-manager-return-problem-and-fix)
10. [Session Persistence](#session-persistence)
11. [Key Files Reference](#key-files-reference)

---

## Overview

The `ComponentTracker` determines whether a component streamed to the client should be a **new component** (`action: "add"`) or an **update to an existing one** (`action: "update"`).

**Why this matters:** When an agent streams text token-by-token, the first chunk creates a new text block on the client (`add`), and subsequent chunks append to it (`update`). Without this, each token would appear as a separate text block.

```
Chunk 1: "Hello"  -> action: "add",    id: AAA  (new block created)
Chunk 2: " world" -> action: "update", id: AAA  (appended to same block)
Chunk 3: "!"      -> action: "update", id: AAA  (appended to same block)
```

---

## Architecture

### Shared Tracker Instance

A **single** `ComponentTracker` instance is created per request and shared across three formatters:

```
team_orchestrator.py (line 457):
    component_tracker = ComponentTracker(session_id)

Assigned to:
    streaming_processor.streaming_formatter.component_tracker  (line 462) -- manager text, checkpoints, etc.
    agent_runner.streaming_formatter.component_tracker          (line 467) -- delegated agent text, task descriptions
    self.streaming_formatter.component_tracker                  (line 472) -- team orchestrator's own formatter
```

All three point to the **same object in memory**. Any mutation (like `reset_for_new_component`) affects all three.

### Separate Local Tracker for Plans

A **second**, independent `ComponentTracker` is created inside `process_streaming_events` (line 97):

```python
component_tracker = ComponentTracker(session_id)  # local variable
```

This local tracker is only passed to `_handle_plan_response`. It is completely independent from the shared tracker above. This ensures plan `add`/`update` logic is isolated.

---

## Internal State

The tracker maintains three dictionaries, all keyed by `agent_id`:

| Dictionary | Type | Purpose |
|---|---|---|
| `agent_components` | `Dict[str, Set[str]]` | All component IDs ever registered for an agent. Used by `get_action()` to decide `add` vs `update`. |
| `_current_component_ids` | `Dict[str, str]` | The **current** component ID for each agent. Returned by `get_current_component_id()` so subsequent chunks target the same component. |
| `_current_component_types` | `Dict[str, str]` | The **current** component type for each agent (`"text"`, `"code"`, etc.). Used by `should_start_new_component()` to detect type changes. |

### Agent IDs Used

| Agent | agent_id value | Example |
|---|---|---|
| Manager | `"manager"` or the manager's DB ObjectId | `"manager"` |
| Delegated agents | Their DB ObjectId | `"698c967366a77e7123d40987"` |
| Plan (local tracker) | `"manager"` | `"manager"` |

Since manager and delegated agents use **different** `agent_id` values, their tracker entries never collide.

---

## Decision Logic

When `format_component_event(agent_id, component_type, ...)` is called **without** explicit `component_id` or `action`, the tracker runs this logic:

```
Was component_id explicitly provided?
  YES -> Use it as-is, default action to "add". TRACKER IS BYPASSED.
  NO  -> Is there a component_tracker?
           NO  -> action="add", generate random UUID.
           YES -> Did the component TYPE change for this agent?
                    YES -> start_new_component() -> action="add", new UUID.
                    NO  -> Has this agent sent components before?
                            NO  -> action="add", generate new UUID, register it.
                            YES -> action="update", reuse current component ID.
```

### Visual Flowchart

```
format_component_event(agent_id, type, data, ...)
          |
    component_id provided?
       /          \
     YES           NO
      |             |
  action="add"   component_tracker exists?
  use given ID      /          \
                  NO            YES
                   |             |
              action="add"   should_start_new_component(agent_id, type)?
              random UUID       /          \
                              YES           NO
                               |             |
                         start_new_component  get_action(agent_id)
                         action="add"            /        \
                         new UUID             "add"      "update"
                                               |           |
                                          register()   get_current_component_id()
                                          new UUID     reuse existing UUID
```

---

## Manager Agent Flow

The manager's text is handled in `streaming_processor.py -> _handle_text_event()`.

### Path: `_handle_text_event` -> `format_streaming_event` -> `format_component_event`

```python
# streaming_processor.py, line 426
output = self.streaming_formatter.format_streaming_event(
    agent_id=manager_id or "manager",
    agent_name=manager_name,
    agent_type="manager",
    chunk=event_text,
    message_id=message_id
)
```

Inside `format_streaming_event` (formatters.py, line 122):

```python
if self.component_tracker and agent_id != "no_id":
    # Maps "chunk" -> "text" component type
    # Calls format_component_event(agent_id=manager_id, component_type="text", ...)
```

Since the shared tracker is assigned, this enters the component-based path.

### Timeline: Manager Speaks First

```
Event 1 (first text chunk):
  - should_start_new_component("manager", "text") -> current_type=None -> False
  - get_action("manager") -> agent_components is empty -> "add"
  - get_current_component_id("manager") -> not found -> register_component() -> generates UUID-A
  - register_component("manager", UUID-A, "text")
  - Result: action="add", id=UUID-A

Event 2 (second text chunk):
  - should_start_new_component("manager", "text") -> "text" == "text" -> False
  - get_action("manager") -> agent_components has UUID-A -> "update"
  - get_current_component_id("manager") -> UUID-A
  - Result: action="update", id=UUID-A  (appended to same block)

Event 3 (third text chunk):
  - Same as Event 2 -> action="update", id=UUID-A
```

### Manager Component Types Sent via the Shared Tracker

| Component | Method | Uses Tracker? | Notes |
|---|---|---|---|
| **Text** | `format_streaming_event` -> `format_component_event` | YES | Main manager text |
| **Chart (dataviz)** | `format_streaming_event` with `content_type="ui"` | YES | Maps "ui" to "chart" type |
| **Sources** | `format_component_event(type="sources")` | YES | Web search results |
| **Checkpoint** | `format_component_event` with explicit `component_id` | NO (bypassed) | Always forced `action="add"` with new UUID |
| **Sandbox** | `format_component_event` with explicit `component_id=call_id` | NO (bypassed) | Uses function call ID |
| **Plan** | `format_component_event` via **local** tracker | NO (separate tracker) | Isolated add/update logic |

---

## Delegated Agent Flow

Delegated agents (search_agent, code_interpreter, etc.) are executed in `AgentRunner.run_agent_tool()` which uses `self.streaming_formatter` -- the same formatter that has the **shared** `ComponentTracker` assigned.

### Key Difference: Different `agent_id`

Delegated agents pass their own `agent_id` (a DB ObjectId like `"698c967366a77e7123d40987"`), which is **different** from the manager's `agent_id` (`"manager"`).

This means:
- Each delegated agent gets its own entries in the tracker dictionaries
- The manager's entries are completely separate
- `reset_for_new_component("manager")` does NOT touch any delegated agent's entries

### Timeline: Delegated Agent (search_agent)

```
Task description (content_type="description"):
  - format_streaming_event(agent_id="698c96...", content_type="description")
  - Maps "description" -> "task" component type
  - get_action("698c96...") -> empty -> "add"
  - register_component("698c96...", UUID-B, "task")
  - Result: action="add", id=UUID-B, type="task"

First text chunk (content_type="chunk"):
  - format_streaming_event(agent_id="698c96...", content_type="chunk")
  - Maps "chunk" -> "text" component type
  - should_start_new_component("698c96...", "text") -> current="task", new="text" -> True (TYPE CHANGED)
  - start_new_component("698c96...", "text") -> generates UUID-C
  - Result: action="add", id=UUID-C, type="text"

Second text chunk:
  - should_start_new_component("698c96...", "text") -> "text" == "text" -> False
  - get_action("698c96...") -> has components -> "update"
  - get_current_component_id("698c96...") -> UUID-C
  - Result: action="update", id=UUID-C  (appended)
```

### Delegated Agent Component Types

| Component | Where Created | Uses Shared Tracker? | Notes |
|---|---|---|---|
| **Task description** | `runner.py` line 98 | YES | `content_type="description"` -> "task" type |
| **Text chunks** | `runner.py` line 225 | YES | Type change from "task" triggers new component |
| **Newline before tool** | `runner.py` line 255 | NO (explicit `component_id`) | Updates existing text component |
| **Sandbox** | `runner.py` line 296 | NO (explicit `component_id=call_id`) | Uses function call ID |
| **Citation** | `runner.py` `_send_citation_component` | YES | New citation components |
| **Search indicator** | `runner.py` via `format_search_event` | Depends | May use explicit `component_id` or tracker |

---

## Plan Component Flow

Plans use a **separate local** `ComponentTracker` created in `process_streaming_events()`:

```python
# streaming_processor.py, line 97
component_tracker = ComponentTracker(session_id)  # LOCAL, not the shared one
```

This local tracker is passed to `_handle_plan_response()`, which creates a temporary formatter:

```python
# streaming_processor.py, line 571
formatter_with_tracker = type(self.streaming_formatter)(component_tracker=component_tracker)
plan_chunk = formatter_with_tracker.format_component_event(
    agent_id="manager",
    component_type="plan",
    ...
)
```

### Timeline: Plan Updates

```
First plan:
  - get_action("manager") on LOCAL tracker -> empty -> "add"
  - Result: action="add", id=UUID-P1

Second plan (update):
  - should_start_new_component("manager", "plan") -> "plan" == "plan" -> False
  - get_action("manager") -> has components -> "update"
  - get_current_component_id("manager") -> UUID-P1
  - Result: action="update", id=UUID-P1  (same plan updated)
```

The local plan tracker is **completely independent** from the shared tracker. The `reset_for_new_component("manager")` call on the shared tracker does NOT affect plan tracking.

---

## Components That Bypass the Tracker

Several components provide explicit `component_id` and/or `action` parameters, which bypass the tracker entirely:

| Component | Location | Why |
|---|---|---|
| **Checkpoints** | `streaming_processor.py` lines 132, 322, 407 | Always `action="add"` with fresh UUID. Each checkpoint is a standalone marker. |
| **Sandbox (function call)** | `streaming_processor.py` line 277, `runner.py` line 296 | Uses `component_id=call_id` (the function call ID). Needs to match the update later. |
| **Sandbox (response)** | `streaming_processor.py` line 653, `runner.py` | Uses `action="update"` + same `component_id=call_id` to update the sandbox with output. |
| **Error components** | `chatbot_servicer.py`, `message_helper.py` | Created as raw dicts without using the formatter at all. Always `action="add"`. |
| **Artifact (file)** | `chatbot_servicer.py` line 150 | Converted from old File format. Always `action="add"`. |

---

## The Manager Return Problem and Fix

### The Problem

When the manager speaks, delegates to agents, then speaks again, the tracker was returning the **same component ID** for the manager's second text block, causing it to be appended to the first.

```
BEFORE FIX:

Manager text block 1: id=AAA, action=add -> update -> update (correct)
  [delegation to search_agent, code_interpreter...]
Manager text block 2: id=AAA, action=update -> update -> update (WRONG - appended to block 1!)
```

**Root cause:** `should_start_new_component("manager", "text")` returned `False` because the type was still `"text"`. The tracker had no way to know the manager went away and came back.

### The Fix

Added `reset_for_new_component(agent_id)` to `ComponentTracker`:

```python
def reset_for_new_component(self, agent_id: str) -> None:
    self.agent_components.pop(agent_id, None)
    self._current_component_ids.pop(agent_id, None)
    self._current_component_types.pop(agent_id, None)
```

Called in `_handle_text_event` when the manager returns after delegation:

```python
# streaming_processor.py, line 402-423
if current_agent and current_agent != manager_name:
    # Send checkpoint...

    # Reset manager's component tracking
    if self.streaming_formatter.component_tracker:
        self.streaming_formatter.component_tracker.reset_for_new_component(manager_id or "manager")
```

### After the Fix

```
AFTER FIX:

Manager text block 1: id=AAA, action=add -> update -> update (correct)
  [delegation to search_agent, code_interpreter...]
  [reset_for_new_component("manager") called]
Manager text block 2: id=BBB, action=add -> update -> update (correct - new block!)
```

### Why This Does NOT Affect Other Agents

1. **Different agent_id keys:** `reset_for_new_component("manager")` only clears the `"manager"` key. Delegated agents use their own ObjectId (e.g., `"698c967366a77e7123d40987"`), which is untouched.

2. **Only called in manager's text handler:** The reset is inside `_handle_text_event()`, which is exclusively the manager's text path. Delegated agents go through `AgentRunner.run_agent_tool()`.

3. **Plan tracker is separate:** Plans use a local `ComponentTracker` instance, not the shared one. The reset has zero impact on plan `add`/`update` logic.

4. **Bypassed components unaffected:** Checkpoints, sandboxes, and errors provide explicit `component_id`/`action` and never consult the tracker.

---

## Session Persistence

The **shared** tracker is saved to the database session state:

```python
# team_orchestrator.py, line 568
state = {
    ...
    "component_tracker": component_tracker.to_dict()
}
```

And restored on the next request in the same conversation:

```python
# team_orchestrator.py, line 515-517
tracker_data = exsiting_session.state.get('component_tracker')
if tracker_data:
    component_tracker = ComponentTracker.from_dict(tracker_data)
```

After `reset_for_new_component("manager")`, the manager's entries are cleared from the saved state. On the next user message, the manager starts fresh with `action="add"` for its first text -- which is the correct behavior for a new response.

The **local** plan tracker is NOT persisted. It is recreated each time `process_streaming_events()` is called.

---

## Key Files Reference

| File | What It Does |
|---|---|
| `src/smart_rag/messaging/component_tracker.py` | The `ComponentTracker` class with all tracking logic |
| `src/smart_rag/messaging/formatters.py` | `StreamingFormatter` that consults the tracker in `format_component_event` and `format_streaming_event` |
| `src/smart_rag/engines/multi_agent/streaming_processor.py` | Manager event processing: text, checkpoints, plans, sandbox, sources. Contains the `reset_for_new_component` call. |
| `src/smart_rag/agents/core/runner.py` | Delegated agent execution: text streaming, sandbox, citations. Uses the shared tracker via `self.streaming_formatter`. |
| `src/smart_rag/engines/multi_agent/team_orchestrator.py` | Creates the shared tracker (line 457), assigns it to all formatters (lines 462-472), persists/restores it (lines 515-568). |
| `src/smart_rag/engines/multi_agent/agentic_workflows/team_configuration.py` | Creates `StreamingFormatter()` without tracker (tracker is assigned later in `team_orchestrator`). |
| `src/grpc_server/chatbot_servicer.py` | Converts component dicts to protobuf. Logs component id, type, and owner before streaming to client. |
| `src/routers/chatbot.py` | REST/SSE streaming. Logs component id, type, and owner before yielding to client. |
