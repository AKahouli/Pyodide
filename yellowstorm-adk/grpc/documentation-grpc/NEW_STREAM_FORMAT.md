# New Stream Format Documentation

## Overview

The stream object structure has been redesigned to support component-based UI rendering with automatic tracking of add vs. update actions.

## New Stream Object Structure

```json
{
    "action": "add" | "update",
    "component": {
        "type": "text" | "code" | "reasoning" | "plan" | "chart" | ...,
        "chunk": "string content",
        "id": "component-uuid"
    },
    "metadata": {
        "message_id": "session-id",
        "agent_id": "agent-uuid",
        "agent_name": "Agent Display Name",
        "agent_type": "manager" | "agent" | ...,
        "chunk_order": 0
    }
}
```

### Field Descriptions

#### `action` (string)
- **`"add"`**: First component from this agent - create new UI component
- **`"update"`**: Subsequent chunks from same agent - update existing component

The system automatically tracks which agents have sent components and determines the action.

#### `component` (object)

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Component type matching ai-sdk.dev types: `text`, `code`, `reasoning`, `plan`, `queue`, `checkpoint`, `chart` |
| `chunk` | string | The actual content/data for this component |
| `id` | string | Unique identifier for this component (UUID) - used to track updates |

#### `metadata` (object)

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | string | Session/message identifier |
| `agent_id` | string | Unique agent identifier |
| `agent_name` | string | Human-readable agent name |
| `agent_type` | string | Agent type (manager, agent, etc.) |
| `chunk_order` | number | Sequential order number for this chunk |

---

## Component Types

Based on [ai-sdk.dev/elements/components/message](https://ai-sdk.dev/elements/components/message):

| Type | Usage | Example Content |
|------|-------|-----------------|
| **`text`** | Regular text/markdown | `"Based on the documents..."` |
| **`code`** | Code blocks | `{"language": "python", "code": "..."}` |
| **`reasoning`** | Agent thinking/searching | `"Searching internal documents for..."` |
| **`plan`** | Task description | `"I will search for sales data"` |
| **`queue`** | Multi-agent workflow | `{"items": [...]}` |
| **`checkpoint`** | Phase transition | `"Delegated to Search Agent"` |
| **`chart`** | Data visualization | `{"data": [...], "config": {...}}` |

---

## How It Works

### 1. Component Tracking

The `ComponentTracker` class tracks which agents have sent components:

```python
from src.smart_rag.messaging.component_tracker import ComponentTracker

# Initialize tracker for session
tracker = ComponentTracker(session_id="session-123")

# First chunk from agent A
action = tracker.get_action("agent-a")  # Returns "add"
component_id = tracker.register_component("agent-a")

# Second chunk from agent A
action = tracker.get_action("agent-a")  # Returns "update"
component_id = tracker.get_current_component_id("agent-a")  # Same ID
```

### 2. Formatting Events

Use the new `format_component_event` method:

```python
from src.smart_rag.messaging.formatters import StreamingFormatter
from src.smart_rag.messaging.component_tracker import ComponentTracker

# Initialize formatter with tracker
tracker = ComponentTracker(session_id)
formatter = StreamingFormatter(component_tracker=tracker)

# Format a text component
event = formatter.format_component_event(
    agent_id="agent-123",
    agent_name="Search Agent",
    agent_type="agent",
    component_type="text",
    chunk="I found 3 relevant documents...",
    message_id="session-id",
    chunk_order=0
)

# Result:
# {
#     "action": "add",  # First from this agent
#     "component": {
#         "type": "text",
#         "chunk": "I found 3 relevant documents...",
#         "id": "component-uuid"
#     },
#     "metadata": {...}
# }
```

### 3. Session Persistence

Component tracking state is automatically saved to the ADK session:

```python
# Saved in session state
state = {
    "system_prompt": "...",
    "agent_name": "...",
    "tools_info": [...],
    "component_tracker": tracker.to_dict()  # Persisted
}

# Restored on session load
if existing_session and existing_session.state:
    tracker_data = existing_session.state.get('component_tracker')
    if tracker_data:
        tracker = ComponentTracker.from_dict(tracker_data)
```

---

## Migration from Old Format

The system supports **backward compatibility**. Old format chunks are automatically converted:

### Old Format
```json
{
    "agent_id": "123",
    "agent_name": "Search Agent",
    "agent_type": "agent",
    "chunk": "text",
    "message_id": "session",
    "message_type": "streaming",
    "content_type": "chunk",
    "chunk_order": 0,
    "chunk_id": "uuid"
}
```

### Automatically Converted To
```json
{
    "action": "add",
    "component": {
        "type": "text",  // mapped from content_type
        "chunk": "text",
        "id": "uuid"
    },
    "metadata": {
        "message_id": "session",
        "agent_id": "123",
        "agent_name": "Search Agent",
        "agent_type": "agent",
        "chunk_order": 0
    }
}
```

### Content Type Mapping

| Old `content_type` | New `component.type` |
|-------------------|---------------------|
| `chunk` | `text` |
| `description` | `plan` |
| `source` | `text` |
| `ui` | `chart` (or custom) |
| `error` | `text` |
| `File` | `text` |
| `final_response` | `text` |

---

## Client Implementation Example

```typescript
interface StreamChunk {
  action: "add" | "update";
  component: {
    type: string;
    chunk: string;
    id: string;
  };
  metadata: {
    message_id: string;
    agent_id: string;
    agent_name: string;
    agent_type: string;
    chunk_order: number;
  };
}

// Track components by ID
const components = new Map<string, MessageContentPart>();

function handleStreamChunk(chunk: StreamChunk) {
  const { action, component, metadata } = chunk;

  if (action === "add") {
    // Create new component
    components.set(component.id, {
      type: component.type,
      content: component.chunk
    });
    renderComponent(component.id);
  } else if (action === "update") {
    // Update existing component
    const existing = components.get(component.id);
    if (existing) {
      existing.content += component.chunk; // Append for text streaming
      updateComponent(component.id);
    }
  }

  // Special handling for final response
  if (component.chunk === "end_of_message") {
    markConversationComplete();
  }
}
```

---

## Changes Made

### Files Modified

1. **`proto/chatbot.proto`**
   - New `Component` message
   - New `Metadata` message
   - Updated `StreamChunk` structure

2. **`src/smart_rag/messaging/component_tracker.py`** (NEW)
   - Component tracking logic
   - Add vs. update determination
   - Session state persistence

3. **`src/smart_rag/messaging/formatters.py`**
   - Added `format_component_event()` method
   - Component tracker integration
   - Backward compatibility maintained

4. **`src/grpc_server/chatbot_servicer.py`**
   - Updated `_dict_to_stream_chunk()` for new format
   - Added `_map_content_type_to_component_type()`
   - Backward compatibility support

5. **`src/smart_rag/engines/multi_agent/team_orchestrator.py`**
   - ComponentTracker initialization
   - Session state integration
   - Tracker restoration from existing sessions

### Files Created

1. **`src/smart_rag/messaging/component_tracker.py`**
2. **`regenerate_proto.sh`** - Script to regenerate protobuf files
3. **`NEW_STREAM_FORMAT.md`** - This documentation

---

## Setup Instructions

### 1. Regenerate Protobuf Files

After updating `proto/chatbot.proto`, regenerate the Python files:

```bash
chmod +x regenerate_proto.sh
./regenerate_proto.sh
```

Or manually:
```bash
python -m grpc_tools.protoc \
    -I. \
    --python_out=. \
    --grpc_python_out=. \
    proto/chatbot.proto
```

### 2. Restart Server

Restart your gRPC server to load the new protobuf definitions:

```bash
# Your server restart command
python -m uvicorn src.main:app --reload
```

### 3. Test with Client

```python
import grpc
from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc

channel = grpc.insecure_channel('localhost:50051')
stub = chatbot_pb2_grpc.ChatbotServiceStub(channel)

for chunk in stub.RunAgentTeam(request):
    print(f"Action: {chunk.action}")
    print(f"Component Type: {chunk.component.type}")
    print(f"Component ID: {chunk.component.id}")
    print(f"Content: {chunk.component.chunk}")
    print(f"Agent: {chunk.metadata.agent_name}")
    print("---")
```

---

## Benefits

✅ **UI Component Tracking**: Each component has a unique ID for tracking
✅ **Automatic Add/Update**: System determines action based on agent history
✅ **ai-sdk.dev Compatible**: Component types match UI library exactly
✅ **Backward Compatible**: Old format chunks still work
✅ **Session Persistent**: Component state survives session reloads
✅ **Type Safe**: Protobuf schema enforces structure

---

## Example Flow

### Scenario: Search Agent Responds

**Chunk 1** (First from Search Agent):
```json
{
  "action": "add",
  "component": {
    "type": "plan",
    "chunk": "I will search for Q4 sales data",
    "id": "comp-uuid-1"
  },
  "metadata": {
    "agent_id": "agent-search-123",
    "agent_name": "Search Agent",
    ...
  }
}
```
→ UI creates new `plan` component with ID `comp-uuid-1`

**Chunk 2** (Search Agent continues):
```json
{
  "action": "update",  // Same agent
  "component": {
    "type": "text",
    "chunk": "I found 3 relevant documents...",
    "id": "comp-uuid-1"  // Same component ID
  },
  ...
}
```
→ UI updates component `comp-uuid-1` with new text

**Chunk 3** (Manager Agent responds):
```json
{
  "action": "add",  // New agent!
  "component": {
    "type": "text",
    "chunk": "Based on Search Agent's findings...",
    "id": "comp-uuid-2"  // New component
  },
  "metadata": {
    "agent_id": "manager-456",  // Different agent
    ...
  }
}
```
→ UI creates new `text` component with ID `comp-uuid-2`

---

## Troubleshooting

### Issue: All chunks show `action: "add"`

**Solution**: Ensure ComponentTracker is properly initialized and passed to StreamingFormatter:

```python
tracker = ComponentTracker(session_id)
formatter = StreamingFormatter(component_tracker=tracker)
```

### Issue: Protobuf import errors

**Solution**: Regenerate protobuf files:
```bash
./regenerate_proto.sh
```

### Issue: Old clients breaking

**Solution**: The gRPC servicer has backward compatibility. Old format chunks are automatically converted.

---

## Next Steps

1. ✅ Update frontend to use new format
2. ✅ Implement component rendering logic
3. ✅ Add support for all ai-sdk.dev component types
4. ✅ Test with multi-agent workflows
5. ✅ Monitor component tracking performance