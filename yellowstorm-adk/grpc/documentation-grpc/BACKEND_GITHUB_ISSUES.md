# Backend GitHub Issues - Component Streaming

Copy these as individual GitHub issues for backend changes only.

---

## Issue #1: Define Complete Component Structure in Protobuf

**Labels:** `backend`, `protobuf`, `completed`

### Description
Define comprehensive component structure in protobuf schema to support all AI SDK-like element types with type safety.

### Changes Made
- Added 8 component type definitions (Text, Code, Reasoning, Plan, Task, Queue, Checkpoint, Chart)
- Added `Component` message with `oneof data` for type safety
- Added `StreamChunk` message with action/component/metadata structure
- Replaced flat streaming format with structured component format

### Protobuf Schema
```protobuf
message Component {
    string id = 1;               // Component unique identifier
    oneof data {
        TextComponent text = 2;
        CodeComponent code = 3;
        ReasoningComponent reasoning = 4;
        PlanComponent plan = 5;
        QueueComponent queue = 6;
        CheckpointComponent checkpoint = 7;
        ChartComponent chart = 8;
        TaskComponent task = 9;
    }
}

message StreamChunk {
    string action = 1;           // "add" or "update"
    Component component = 2;     // The component data
    Metadata metadata = 3;       // Metadata about the chunk
}
```

### Files
- `proto/chatbot.proto`

### Commit
557a989d

---

## Issue #2: Add TaskComponent Definition to Protobuf

**Labels:** `backend`, `protobuf`, `feature`, `completed`

### Description
Add TaskComponent message definition to support displaying task descriptions with status indicators, replacing the old "plan" component.

### Why TaskComponent vs PlanComponent?
- Simpler structure (no nested steps)
- Focused on single agent tasks
- Status field enables visual progress indicators
- Items array allows progressive updates
- Better matches AI SDK Task element

### Protobuf Definition
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

### Example Usage
```python
# Backend sends
{
    "action": "add",
    "component": {
        "id": "search_agent_123",
        "type": "task",
        "data": {
            "title": "search_agent",
            "items": [{"text": "Searching documents..."}],
            "status": "in_progress"
        }
    }
}
```

### Files
- `proto/chatbot.proto` (lines 97-105)

---

## Issue #3: Regenerate Protobuf Python Code

**Labels:** `backend`, `protobuf`, `build`, `completed`

### Description
Regenerate Python protobuf code from updated proto schema using official generation script.

### Command
```bash
python scripts/generate_proto.py
```

### Output Files
- `src/grpc_generated/chatbot_pb2.py` (7,757 bytes)
- `src/grpc_generated/chatbot_pb2_grpc.py` (3,366 bytes)

### Success Output
```
Generating protobuf code...
✅ Protobuf code generation successful!
✓ src/grpc_generated/chatbot_pb2.py (7,757 bytes)
✓ src/grpc_generated/chatbot_pb2_grpc.py (3,366 bytes)
```

### Why Important
- Without regeneration, backend cannot serialize TaskComponent
- Falls back to TextComponent when task type is missing in generated code
- Must be run after ANY proto schema changes

### Note
Always use `scripts/generate_proto.py` instead of manual `protoc` command to ensure proper import fixes.

---

## Issue #4: Create ComponentTracker for Add/Update Actions

**Labels:** `backend`, `feature`, `completed`

### Description
Create ComponentTracker class to track which agents have sent components, enabling proper add vs update action determination.

### Problem It Solves
Without tracking:
- Every message creates a new component (always "add")
- UI shows multiple duplicate components
- Cannot update existing component incrementally

With tracking:
- First message = "add" (create new component)
- Subsequent messages = "update" (merge with existing)
- Single component per agent in UI

### Implementation
```python
class ComponentTracker:
    """Tracks components sent by agents to determine add/update actions."""

    def __init__(self):
        self.agent_components: Dict[str, List[str]] = {}

    def get_action(self, agent_id: str) -> str:
        """Returns 'add' for first component, 'update' for subsequent."""
        if agent_id not in self.agent_components or not self.agent_components[agent_id]:
            return "add"
        return "update"

    def register_component(self, agent_id: str, component_id: str = None) -> str:
        """Register a component for an agent."""
        if agent_id not in self.agent_components:
            self.agent_components[agent_id] = []
        if component_id is None:
            component_id = f"{agent_id}_{str(uuid.uuid4())[:8]}"
        self.agent_components[agent_id].append(component_id)
        return component_id

    def get_current_component_id(self, agent_id: str) -> str:
        """Get current component ID for an agent."""
        if agent_id in self.agent_components and self.agent_components[agent_id]:
            return self.agent_components[agent_id][-1]
        return f"{agent_id}_{str(uuid.uuid4())[:8]}"
```

### Files
- `src/smart_rag/messaging/component_tracker.py` (NEW FILE)

### Debug Logging Added
- 🆕 `[ComponentTracker] ACTION='add'` for first component
- 🔄 `[ComponentTracker] ACTION='update'` for existing component
- 📝 `[ComponentTracker] REGISTERED` when component registered

---

## Issue #5: Update StreamingFormatter to Support Components

**Labels:** `backend`, `feature`, `completed`

### Description
Update StreamingFormatter class to support new component-based streaming with ComponentTracker integration while maintaining backward compatibility.

### Key Changes

**1. Added ComponentTracker to constructor:**
```python
def __init__(self, component_tracker: Optional[ComponentTracker] = None):
    self.component_tracker = component_tracker
```

**2. Changed "description" → "task" mapping:**
```python
component_type_map = {
    "chunk": "text",
    "description": "task",  # Changed from "plan"
    "source": "text",
    "final_response": "text",
    "ui": "chart",
}
```

**3. Added task-specific data formatting:**
```python
if component_type == "task":
    component_data = {
        "title": agent_name,
        "items": [{"text": chunk}],  # Items array
        "status": "in_progress"      # Not "active"
    }
```

**4. Added format_component_event method:**
```python
def format_component_event(self, agent_id: str, component_type: str,
                          component_data: Dict[str, Any], message_id: str) -> Dict[str, Any]:
    """Format streaming event using new component-based structure."""
    if self.component_tracker:
        action = self.component_tracker.get_action(agent_id)
        component_id = self.component_tracker.get_current_component_id(agent_id)
        if action == "add":
            self.component_tracker.register_component(agent_id, component_id)

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

### Backward Compatibility
- Old format still works when ComponentTracker is None
- Automatically detects which format to use
- Gradual migration without breaking existing code

### Files
- `src/smart_rag/messaging/formatters.py`

### Debug Logging Added
- 🔍 `[Formatter] content_type=..., agent_id=..., has_tracker=...`
- ✅ `[Formatter] Using NEW component format`
- ⚠️ `[Formatter] Using OLD format`
- 📤 `[StreamFormatter] STREAMING component: action=..., type=..., id=...`

---

## Issue #6: Update gRPC Servicer to Build Component Messages

**Labels:** `backend`, `grpc`, `completed`

### Description
Update ChatbotServicer to convert internal dictionary format to protobuf Component messages with proper oneof handling for all component types.

### Problem
Internal format uses dictionaries:
```python
{
    "action": "add",
    "component": {
        "type": "task",
        "data": {"title": "...", "items": [...]}
    }
}
```

Protobuf needs proper message instances:
```python
chatbot_pb2.StreamChunk(
    action="add",
    component=chatbot_pb2.Component(
        task=chatbot_pb2.TaskComponent(
            title="...",
            items=[chatbot_pb2.TaskItem(text="...")]
        )
    )
)
```

### Solution: Added _build_component Method

```python
def _build_component(self, component_id: str, component_type: str,
                     component_data: Dict[str, Any]) -> "chatbot_pb2.Component":
    """Build Component protobuf message with appropriate oneof field."""
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

### Updated _dict_to_stream_chunk

```python
def _dict_to_stream_chunk(self, chunk_dict: Dict[str, Any]) -> "chatbot_pb2.StreamChunk":
    """Convert internal chunk dictionary to protobuf StreamChunk."""

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

### Why Important
- Proper oneof field handling ensures correct protobuf serialization
- Each component type has specific field requirements
- TaskComponent requires items array conversion
- Missing this code causes fallback to text type

### Files
- `src/grpc_server/chatbot_servicer.py`

---

## Issue #7: Add Comprehensive Debug Logging

**Labels:** `backend`, `debugging`, `completed`

### Description
Add emoji-based debug logging throughout the backend streaming pipeline for easy troubleshooting and pipeline tracing.

### Logging Added

**ComponentTracker** (`component_tracker.py`):
- 🆕 `[ComponentTracker] ACTION='add' for agent_id=...` - New component
- 🔄 `[ComponentTracker] ACTION='update' for agent_id=...` - Update existing
- 📝 `[ComponentTracker] REGISTERED component_id=... for agent_id=...` - Component registered

**StreamingFormatter** (`formatters.py`):
- 🔍 `[Formatter] content_type=..., agent_id=..., has_tracker=...` - Format detection
- ✅ `[Formatter] Using NEW component format for ...` - New format used
- ⚠️ `[Formatter] Using OLD format (no tracker or agent_id='...')` - Fallback
- 📤 `[StreamFormatter] STREAMING component: action=..., type=..., id=..., agent=..., data=...` - Component sent

### Benefits
- Easy end-to-end pipeline tracing
- Quickly identify where format breaks
- Visual indicators with emoji for log scanning
- Helps debug type mismatches (task vs text)
- Verifies agent_id is passed correctly

### Example Log Flow
```
🔍 [Formatter] content_type=description, agent_id=search_agent_123, has_tracker=True
✅ [Formatter] Using NEW component format for description
🆕 [ComponentTracker] ACTION='add' for agent_id=search_agent_123 (first component)
📝 [ComponentTracker] REGISTERED component_id=search_agent_123_a1b2c3d4 for agent_id=search_agent_123 (total: 1)
📤 [StreamFormatter] STREAMING component: action=add, type=task, id=search_agent_123_a1b2c3d4, agent=search_agent_123, data={'title': 'search_agent', 'items': [{'text': 'Searching...'}], 'status': 'in_progress'}...
```

### Files
- `src/smart_rag/messaging/component_tracker.py`
- `src/smart_rag/messaging/formatters.py`

---

## Issue #8: Pass agent_id to run_agent_tool

**Labels:** `backend`, `bug`, `high-priority`, `in-progress`

### Description
The `run_agent_tool` function is called without `agent_id` parameter, causing it to default to `"no_id"`. This prevents ComponentTracker from working correctly.

### Problem

**Current code** (`team_orchestrator.py:754`):
```python
result = await runner.run_agent_tool(agent, task, session_helper, queue)
# Missing: agent_id parameter
```

**Result:**
- agent_id defaults to "no_id"
- ComponentTracker is bypassed (fallback to old format)
- Every message creates new component (always "add")
- Logs show: `⚠️ [Formatter] Using OLD format (no tracker or agent_id='no_id')`

### Solution

```python
# Extract agent.id before calling run_agent_tool
agent_id = getattr(agent, 'id', 'no_id')

# Pass agent_id parameter
result = await runner.run_agent_tool(
    agent, task, session_helper, queue, agent_id=agent_id
)
```

### Expected Behavior After Fix

**Logs should show:**
```
🔍 [Formatter] content_type=description, agent_id=6964c7e915f75336d1b88f24, has_tracker=True
✅ [Formatter] Using NEW component format for description
🆕 [ComponentTracker] ACTION='add' for agent_id=6964c7e915f75336d1b88f24
📤 [StreamFormatter] STREAMING component: action=add, type=task, id=6964c7e915f75336d1b88f24_a1b2c3d4
```

### Tasks
- [ ] Update `_run_agent` method in `team_orchestrator.py` to extract agent.id
- [ ] Pass agent_id to run_agent_tool call
- [ ] Verify ComponentTracker receives correct agent_id
- [ ] Test that logs show correct agent_id (not "no_id")
- [ ] Test that subsequent messages from same agent show `action=update`

### Files to Modify
- `src/smart_rag/engines/multi_agent/team_orchestrator.py` (line ~754)

### Verification
After fix, test with:
```bash
# Send query to agent
# Check logs for:
grep "agent_id=6964c7e915f75336d1b88f24" logs.txt  # Should see actual agent ID
grep "no_id" logs.txt  # Should NOT appear for agents with IDs
```

---

## Issue #9: Add Task Status Updates on Completion

**Labels:** `backend`, `feature`, `enhancement`

### Description
Backend should send status update chunk when agent completes its task to change status from "in_progress" to "completed".

### Current Behavior
- Agent starts: sends task with `status: "in_progress"`
- Agent completes: **no status update sent**
- UI keeps showing spinning icon forever ⏳

### Expected Behavior

**Agent starts:**
```python
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
```

**Agent completes:**
```python
yield formatter.format_component_event(
    agent_id=agent_id,
    component_type="task",
    component_data={"status": "completed"},  # Only status field
    message_id=message_id
)
```

### Implementation

**Location:** `src/smart_rag/agents/core/runner.py`

```python
async def run_agent_tool(self, agent, task, session_helper, queue, agent_id="no_id"):
    try:
        # Send initial task status
        yield self.formatter.format_component_event(
            agent_id=agent_id,
            component_type="task",
            component_data={
                "title": agent.name,
                "items": [{"text": task}],
                "status": "in_progress"
            },
            message_id=session_helper.message_id
        )

        # Execute agent
        result = await agent.execute(task)

        # Send completion status update
        yield self.formatter.format_component_event(
            agent_id=agent_id,
            component_type="task",
            component_data={"status": "completed"},  # Just status
            message_id=session_helper.message_id
        )

        return result
    except Exception as e:
        # Send error status
        yield self.formatter.format_component_event(
            agent_id=agent_id,
            component_type="task",
            component_data={
                "status": "error",
                "items": [{"text": f"Error: {str(e)}"}]
            },
            message_id=session_helper.message_id
        )
```

### UI Impact
- Spinning icon (⏳) changes to green checkmark (✅) when completed
- Already implemented in frontend - just needs backend update
- Frontend merges status field with existing component data

### Files to Modify
- `src/smart_rag/agents/core/runner.py`
- Possibly `src/smart_rag/engines/multi_agent/streaming_processor.py`

### Testing
1. Send query to agent
2. Check initial status: `status: "in_progress"`
3. Wait for agent completion
4. Check final status: `status: "completed"`
5. Verify UI shows green checkmark

---

## Issue #10: Add Error Status for Failed Tasks

**Labels:** `backend`, `feature`, `error-handling`

### Description
Add error state handling for tasks that fail during execution with visual feedback in UI.

### Changes Needed

**1. Update Documentation** (status field already supports any string):
```protobuf
message TaskComponent {
    string title = 1;
    repeated TaskItem items = 2;
    string status = 3;  // "pending", "in_progress", "completed", or "error"
}
```

**2. Send Error Status in Exception Handler:**
```python
try:
    # Agent execution
    result = await agent.execute(task)
except Exception as e:
    logger.error(f"Agent {agent_id} failed: {str(e)}")

    # Send error status update
    yield formatter.format_component_event(
        agent_id=agent_id,
        component_type="task",
        component_data={
            "status": "error",
            "items": [{"text": f"❌ Error: {str(e)}"}]
        },
        message_id=message_id
    )
```

**3. Optional: Add error_message Field:**
```protobuf
message TaskComponent {
    string title = 1;
    repeated TaskItem items = 2;
    string status = 3;
    string error_message = 4;  // NEW - detailed error info
}
```

### UI Impact
- Red error icon (🔴) instead of spinning icon
- Red styling for task card
- Error message displayed to user
- No frontend changes needed (status already handled)

### Example Error Display
```
🔴 search_agent [error]
• ❌ Error: Unable to connect to vector store
• Request timeout after 30s
```

### Files to Modify
- `proto/chatbot.proto` (optional: add error_message field)
- `src/smart_rag/agents/core/runner.py` (error handling)
- `src/smart_rag/engines/multi_agent/team_orchestrator.py` (error propagation)

### Testing
1. Cause agent to fail (disconnect database, invalid query, etc.)
2. Check status update sent: `status: "error"`
3. Verify error message in items array
4. Check UI shows red error styling

---

## Issue #11: Support Progressive Task Item Updates

**Labels:** `backend`, `enhancement`, `optimization`

### Description
Allow tasks to progressively add items instead of sending all items repeatedly, reducing network bandwidth and enabling cleaner incremental updates.

### Current Behavior

**First update:**
```python
{"items": [{"text": "Step 1"}]}
```

**Second update (sends ALL items again):**
```python
{"items": [{"text": "Step 1"}, {"text": "Step 2"}]}
```

### Proposed Behavior

**First update:**
```python
{"items": [{"text": "Step 1"}]}
```

**Second update (sends ONLY new item):**
```python
{
    "items": [{"text": "Step 2"}],
    "append_items": true  # NEW flag
}
```

### Implementation

**Backend Changes:**
```python
# Send first item
yield formatter.format_component_event(
    agent_id=agent_id,
    component_type="task",
    component_data={
        "title": agent_name,
        "items": [{"text": "Searching documents..."}],
        "status": "in_progress"
    },
    message_id=message_id
)

# Append second item
yield formatter.format_component_event(
    agent_id=agent_id,
    component_type="task",
    component_data={
        "items": [{"text": "Found 3 matches"}],
        "append_items": True  # Flag to append
    },
    message_id=message_id
)
```

**Frontend Changes Required:**
```typescript
if (item.action === 'update' && item.component.data.append_items) {
    // Append items to existing array
    const existing = newComponents.get(item.component.id);
    existing.data.items = [
        ...(existing.data.items || []),
        ...item.component.data.items
    ];
} else {
    // Replace items
    existing.data.items = item.component.data.items;
}
```

### Benefits
- Less data sent over network (only new items)
- Cleaner backend code (no need to track all previous items)
- Progressive reveal of task steps in UI
- Reduces memory usage for long task lists

### Files to Modify
- `src/smart_rag/messaging/formatters.py` (add append_items support)
- Frontend `page.tsx` (merge logic update)

### Optional: Protobuf Field
```protobuf
message TaskComponent {
    string title = 1;
    repeated TaskItem items = 2;
    string status = 3;
    bool append_items = 4;  // NEW - if true, append items to existing
}
```

---

## Summary

**Total Backend Issues:** 11
- ✅ **Completed:** 7 (Issues #1-7)
- 🔄 **In Progress:** 1 (Issue #8 - Pass agent_id)
- 📋 **Pending:** 3 (Issues #9-11)

**Critical Path:**
1. Fix Issue #8 (agent_id) - Enables component tracking
2. Implement Issue #9 (status updates) - Completes user experience
3. Add Issue #10 (error handling) - Production readiness

**Files Modified:**
- `proto/chatbot.proto` - Component definitions
- `src/grpc_generated/*` - Regenerated code
- `src/smart_rag/messaging/component_tracker.py` - NEW FILE
- `src/smart_rag/messaging/formatters.py` - Component support
- `src/grpc_server/chatbot_servicer.py` - Component building
