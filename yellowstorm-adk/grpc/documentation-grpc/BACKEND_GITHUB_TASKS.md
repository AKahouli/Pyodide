# Backend GitHub Tasks - Component Streaming with Task Type

## Overview
This document tracks backend-only changes for implementing component-based streaming with task type support in the gRPC API.

## ✅ Completed Backend Tasks

### 1. Define Complete Component Structure in Protobuf
**Status:** ✅ Done
**File:** `proto/chatbot.proto`
**Priority:** High

**Description:**
Defined comprehensive component structure in protobuf schema to support all AI SDK-like element types with type safety.

**Changes Made:**
1. Added component type definitions:
   - `TextComponent` - Plain text/markdown content
   - `CodeComponent` - Code blocks with language and filename
   - `ReasoningComponent` - Agent thinking process
   - `PlanComponent` - Multi-step plans
   - `TaskComponent` - Task items with status (NEW)
   - `QueueComponent` - Workflow queue items
   - `CheckpointComponent` - Phase markers
   - `ChartComponent` - Data visualization

2. Added `Component` message with `oneof` for type safety:
```protobuf
message Component {
    string id = 1;
    oneof data {
        TextComponent text = 2;
        CodeComponent code = 3;
        ReasoningComponent reasoning = 4;
        PlanComponent plan = 5;
        QueueComponent queue = 6;
        CheckpointComponent checkpoint = 7;
        ChartComponent chart = 8;
        TaskComponent task = 9;  // NEW
    }
}
```

3. Added `StreamChunk` message with action/component/metadata:
```protobuf
message StreamChunk {
    string action = 1;           // "add" or "update"
    Component component = 2;     // The component data
    Metadata metadata = 3;       // Message/agent metadata
}
```

**Commit:** Part of commit `557a989d`

---

### 2. Add TaskComponent Definition to Protobuf
**Status:** ✅ Done
**File:** `proto/chatbot.proto`
**Priority:** High

**Description:**
Added TaskComponent message definition to support displaying task descriptions with status indicators.

**Changes Made:**
```protobuf
message TaskItem {
    string text = 1;             // Task item text
}

message TaskComponent {
    string title = 1;            // Task title (agent name)
    repeated TaskItem items = 2; // List of task items
    string status = 3;           // "pending", "in_progress", or "completed"
}
```

**Why Important:**
- Replaces old "plan" component for task descriptions
- Simpler structure than plan (no nested steps)
- Status field enables visual progress indicators
- Items array allows progressive updates

**Related:** Issue #10 in GITHUB_ISSUES.md

---

### 3. Regenerate Protobuf Python Code
**Status:** ✅ Done
**Files:**
- `src/grpc_generated/chatbot_pb2.py` (7,757 bytes)
- `src/grpc_generated/chatbot_pb2_grpc.py` (3,366 bytes)
**Priority:** High

**Description:**
Regenerated Python protobuf code from updated proto schema using official generation script.

**Command Used:**
```bash
python scripts/generate_proto.py
```

**Output:**
```
Generating protobuf code...
✅ Protobuf code generation successful!
✓ src/grpc_generated/chatbot_pb2.py (7,757 bytes)
✓ src/grpc_generated/chatbot_pb2_grpc.py (3,366 bytes)
```

**Why Important:**
- Without regeneration, backend cannot serialize TaskComponent
- Falls back to TextComponent when task type is missing
- Must be run after any proto schema changes

---

### 4. Create ComponentTracker for Add/Update Actions
**Status:** ✅ Done
**File:** `src/smart_rag/messaging/component_tracker.py` (NEW FILE)
**Priority:** High

**Description:**
Created ComponentTracker class to track which agents have sent components, enabling proper add vs update action determination.

**Implementation:**
```python
class ComponentTracker:
    """Tracks components sent by agents to determine add/update actions."""

    def __init__(self):
        self.agent_components: Dict[str, List[str]] = {}

    def get_action(self, agent_id: str) -> str:
        """Determine if this should be 'add' or 'update'.

        Returns:
            "add" if agent hasn't sent any components yet
            "update" if agent has existing components
        """
        if agent_id not in self.agent_components or not self.agent_components[agent_id]:
            print(f"🆕 [ComponentTracker] ACTION='add' for agent_id={agent_id}")
            return "add"
        print(f"🔄 [ComponentTracker] ACTION='update' for agent_id={agent_id}")
        return "update"

    def register_component(self, agent_id: str, component_id: str = None) -> str:
        """Register a component for an agent."""
        if agent_id not in self.agent_components:
            self.agent_components[agent_id] = []

        if component_id is None:
            component_id = f"{agent_id}_{str(uuid.uuid4())[:8]}"

        self.agent_components[agent_id].append(component_id)
        print(f"📝 [ComponentTracker] REGISTERED component_id={component_id}")
        return component_id

    def get_current_component_id(self, agent_id: str) -> str:
        """Get current component ID for an agent."""
        if agent_id in self.agent_components and self.agent_components[agent_id]:
            return self.agent_components[agent_id][-1]
        return f"{agent_id}_{str(uuid.uuid4())[:8]}"
```

**Why Important:**
- Enables incremental updates to same component
- First message from agent = "add" (create new component)
- Subsequent messages = "update" (merge with existing)
- Prevents duplicate components in UI

---

### 5. Update StreamingFormatter to Support Components
**Status:** ✅ Done
**File:** `src/smart_rag/messaging/formatters.py`
**Priority:** High

**Description:**
Updated StreamingFormatter class to support new component-based streaming with ComponentTracker integration.

**Key Changes:**

1. **Added ComponentTracker to constructor:**
```python
def __init__(self, component_tracker: Optional[ComponentTracker] = None):
    self.component_tracker = component_tracker
```

2. **Added format_component_event method:**
```python
def format_component_event(self, agent_id: str, component_type: str,
                          component_data: Dict[str, Any], message_id: str) -> Dict[str, Any]:
    """Format a streaming event using new component-based structure."""
    if self.component_tracker:
        action = self.component_tracker.get_action(agent_id)
        component_id = self.component_tracker.get_current_component_id(agent_id)
        if action == "add":
            self.component_tracker.register_component(agent_id, component_id)
    else:
        action = "add"
        component_id = str(uuid.uuid4())

    return {
        "action": action,
        "component": {
            "id": component_id,
            "type": component_type,
            "data": component_data
        },
        "metadata": {
            "message_id": message_id,
            "agent_id": agent_id
        }
    }
```

3. **Changed "description" → "task" mapping:**
```python
component_type_map = {
    "chunk": "text",
    "description": "task",  # Changed from "plan" to "task"
    "source": "text",
    "final_response": "text",
    "ui": "chart",
    "File": "text",
    "error": "text"
}
```

4. **Added task-specific data formatting:**
```python
if component_type == "task":
    component_data = {
        "title": agent_name,
        "items": [{"text": chunk}],  # Items array instead of description
        "status": "in_progress"      # in_progress instead of active
    }
```

5. **Added debug logging:**
```python
print(f"📤 [StreamFormatter] STREAMING component: action={action}, type={component_type}, id={component_id}")
```

**Backward Compatibility:**
- Old format still supported when ComponentTracker is None
- Automatically detects which format to use
- Gradual migration without breaking existing code

---

### 6. Update gRPC Servicer to Build Component Messages
**Status:** ✅ Done
**File:** `src/grpc_server/chatbot_servicer.py`
**Priority:** High

**Description:**
Updated ChatbotServicer to convert internal dictionary format to protobuf Component messages with proper oneof handling.

**Key Changes:**

1. **Updated _dict_to_stream_chunk to detect new format:**
```python
def _dict_to_stream_chunk(self, chunk_dict: Dict[str, Any]) -> "chatbot_pb2.StreamChunk":
    # Check if this is the new component-based format
    if "action" in chunk_dict and "component" in chunk_dict:
        component_dict = chunk_dict["component"]
        metadata = chunk_dict["metadata"]

        component = self._build_component(
            component_id=component_dict.get("id", ""),
            component_type=component_dict.get("type", "text"),
            component_data=component_dict.get("data", {})
        )

        return chatbot_pb2.StreamChunk(
            action=chunk_dict["action"],
            component=component,
            metadata=chatbot_pb2.Metadata(
                message_id=metadata.get("message_id", ""),
                agent_id=metadata.get("agent_id", "")
            )
        )
```

2. **Added _build_component method:**
```python
def _build_component(self, component_id: str, component_type: str,
                     component_data: Dict[str, Any]) -> "chatbot_pb2.Component":
    """Build a Component protobuf message with appropriate oneof field."""
    component_kwargs = {"id": component_id}

    if component_type == "text":
        component_kwargs["text"] = chatbot_pb2.TextComponent(
            content=component_data.get("content", "")
        )
    elif component_type == "task":
        items = []
        for item_data in component_data.get("items", []):
            items.append(chatbot_pb2.TaskItem(
                text=item_data.get("text", "")
            ))
        component_kwargs["task"] = chatbot_pb2.TaskComponent(
            title=component_data.get("title", ""),
            items=items,
            status=component_data.get("status", "in_progress")
        )
    elif component_type == "code":
        component_kwargs["code"] = chatbot_pb2.CodeComponent(
            content=component_data.get("content", ""),
            language=component_data.get("language", ""),
            filename=component_data.get("filename", "")
        )
    # ... other component types

    return chatbot_pb2.Component(**component_kwargs)
```

**Why Important:**
- Proper oneof field handling ensures correct protobuf serialization
- Each component type has specific field requirements
- TaskComponent requires items array conversion
- Missing this code causes fallback to text type

---

### 7. Add Comprehensive Debug Logging
**Status:** ✅ Done
**Files:**
- `src/smart_rag/messaging/component_tracker.py`
- `src/smart_rag/messaging/formatters.py`
**Priority:** Medium

**Description:**
Added emoji-based debug logging throughout the backend streaming pipeline for easy troubleshooting.

**Logging Added:**

**ComponentTracker:**
- 🆕 `[ComponentTracker] ACTION='add'` - New component creation
- 🔄 `[ComponentTracker] ACTION='update'` - Existing component update
- 📝 `[ComponentTracker] REGISTERED` - Component registered

**StreamingFormatter:**
- 🔍 `[Formatter] content_type=..., agent_id=..., has_tracker=...` - Format detection
- ✅ `[Formatter] Using NEW component format` - New format used
- ⚠️ `[Formatter] Using OLD format` - Fallback to old format
- 📤 `[StreamFormatter] STREAMING component: action=..., type=..., id=...` - Component sent

**Benefits:**
- Easy pipeline tracing from logs
- Quickly identify where format breaks
- Visual indicators with emoji for scanning
- Helps debug type mismatches

---

## 📋 Pending Backend Tasks

### 8. Pass agent_id to run_agent_tool
**Status:** 📋 Pending
**File:** `src/smart_rag/engines/multi_agent/team_orchestrator.py`
**Priority:** High

**Description:**
The `run_agent_tool` function is called without `agent_id` parameter, causing it to default to `"no_id"`. This prevents ComponentTracker from working correctly.

**Problem:**
```python
# team_orchestrator.py:754
result = await runner.run_agent_tool(agent, task, session_helper, queue)
# Missing: agent_id parameter
```

**Expected behavior when agent_id="no_id":**
- ComponentTracker is bypassed
- Falls back to old streaming format
- Every message creates new component (always "add")

**Solution:**
```python
# Extract agent.id before calling run_agent_tool
agent_id = getattr(agent, 'id', 'no_id')
result = await runner.run_agent_tool(
    agent, task, session_helper, queue, agent_id=agent_id
)
```

**Tasks:**
- [ ] Update `_run_agent` method to extract agent.id
- [ ] Pass agent_id to run_agent_tool
- [ ] Verify ComponentTracker receives correct agent_id
- [ ] Test that logs show correct agent_id (not "no_id")

**Related:** Issue #20 in GITHUB_ISSUES.md

---

### 9. Add Task Status Updates on Completion
**Status:** 📋 Pending
**File:** `src/smart_rag/agents/core/runner.py`
**Priority:** Medium

**Description:**
Backend should send status update chunk when agent completes its task to change status from "in_progress" to "completed".

**Current Behavior:**
- Agent starts: sends task with `status: "in_progress"`
- Agent completes: no status update sent
- UI keeps showing spinning icon forever

**Expected Behavior:**
```python
# Agent starts
yield formatter.format_component_event(
    agent_id=agent_id,
    component_type="task",
    component_data={
        "title": agent_name,
        "items": [{"text": "Processing query..."}],
        "status": "in_progress"
    },
    message_id=message_id
)

# Agent completes
yield formatter.format_component_event(
    agent_id=agent_id,
    component_type="task",
    component_data={"status": "completed"},  # Just status update
    message_id=message_id
)
```

**Implementation:**
1. In `runner.py`, after agent execution completes
2. Send update chunk with `action: "update"`
3. Only include status field (frontend merges)
4. UI automatically shows green checkmark

**Files to Modify:**
- `src/smart_rag/agents/core/runner.py`
- Possibly `src/smart_rag/engines/multi_agent/streaming_processor.py`

---

### 10. Add Error Status for Failed Tasks
**Status:** 📋 Pending
**Files:**
- `proto/chatbot.proto`
- `src/smart_rag/messaging/formatters.py`
**Priority:** Medium

**Description:**
Add error state handling for tasks that fail during execution.

**Changes Needed:**

1. **Protobuf:** Status field already supports any string, add "error" to docs
2. **Formatter:** Send error status when exception caught:
```python
try:
    # Agent execution
    pass
except Exception as e:
    yield formatter.format_component_event(
        agent_id=agent_id,
        component_type="task",
        component_data={
            "status": "error",
            "items": [{"text": f"Error: {str(e)}"}]
        },
        message_id=message_id
    )
```

3. **Optional:** Add error_message field to TaskComponent:
```protobuf
message TaskComponent {
    string title = 1;
    repeated TaskItem items = 2;
    string status = 3;
    string error_message = 4;  // NEW
}
```

**UI Impact:**
- Red error icon and styling
- Error message display
- No need for frontend changes (already handles any status)

---

### 11. Support Progressive Task Item Updates
**Status:** 📋 Pending
**File:** `src/smart_rag/messaging/formatters.py`
**Priority:** Low

**Description:**
Allow tasks to progressively add items instead of replacing all at once.

**Current Behavior:**
```python
# First update - sends all items
{"items": [{"text": "Step 1"}]}

# Second update - replaces items
{"items": [{"text": "Step 1"}, {"text": "Step 2"}]}
```

**Proposed Behavior:**
```python
# First update
{"items": [{"text": "Step 1"}]}

# Second update - append only
{"items": [{"text": "Step 2"}]}  # Frontend appends to existing
```

**Implementation:**
- Add `append_items: bool` field to component data
- Frontend checks flag and appends vs replaces
- Backend sends only new items with append flag

**Benefits:**
- Less data sent over network
- Cleaner backend code
- Progressive reveal of task steps

---

## 📊 Summary

**Total Backend Tasks:** 11
- ✅ **Completed:** 7
- 📋 **Pending:** 4

**Key Achievements:**
- ✅ Complete protobuf component structure (8 types)
- ✅ TaskComponent definition and generation
- ✅ ComponentTracker for add/update logic
- ✅ StreamingFormatter with new format support
- ✅ gRPC servicer component building
- ✅ Comprehensive debug logging
- ✅ Backward compatibility maintained

**Critical Pending:**
- 📋 Pass agent_id to run_agent_tool (HIGH PRIORITY)
- 📋 Add task status updates on completion

**Files Changed:**
```
proto/chatbot.proto                                (protobuf schema)
src/grpc_generated/chatbot_pb2.py                  (regenerated)
src/grpc_generated/chatbot_pb2_grpc.py             (regenerated)
src/smart_rag/messaging/component_tracker.py       (NEW FILE)
src/smart_rag/messaging/formatters.py              (component support)
src/grpc_server/chatbot_servicer.py                (component building)
```

**Testing:**
- gRPC proxy correctly converts task components
- Frontend receives `type=task` (not `type=text`)
- Status updates work correctly
- Multiple agents create separate components

---

## Related Documentation

- `GITHUB_ISSUES.md` - Individual GitHub issue templates
- `GITHUB_TASKS.md` - Full project tasks (backend + frontend)
- `API_TO_UI_MAPPING.md` - Component type mappings
- `COMPONENT_STREAMING_GUIDE.md` - Add/update logic guide
- `docs/V2_FINAL_SCHEMA.md` - V2 API schema documentation
