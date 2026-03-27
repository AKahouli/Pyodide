# Quick Start: New Stream Format

## 🚀 Getting Started in 3 Steps

### Step 1: Regenerate Protobuf Files

```bash
cd /home/rabeb/PycharmProjects/Whitelabel-codex/api-metachatbot-adk
./regenerate_proto.sh
```

Expected output:
```
✅ Protobuf files regenerated successfully!
Generated files:
  - src/grpc_generated/chatbot_pb2.py
  - src/grpc_generated/chatbot_pb2_grpc.py
```

### Step 2: Restart Your Server

```bash
# Make sure you're in the right environment
# Then restart the server
```

### Step 3: Test the New Format

```bash
python test_real_data.py
```

---

## 📊 What You'll See Now

### Old Format Output
```
--- Stream Object ---
agent_id: 123
agent_name: Search Agent
content_type: chunk
chunk: Based on documents...
```

### New Format Output
```
--- Stream Object ---
Action: add
Component Type: text
Component ID: uuid-123
Content: Based on documents...
Agent: Search Agent
```

---

## 🎯 Key Changes

1. **`action` field**: Automatically tracks "add" vs "update"
   - First chunk from agent → `"add"`
   - Subsequent chunks → `"update"`

2. **`component` object**: Contains type, content, and ID
   - `type`: Matches ai-sdk.dev types (text, plan, chart, etc.)
   - `chunk`: The actual content
   - `id`: Unique identifier for tracking

3. **`metadata` object**: All context about the chunk
   - `message_id`, `agent_id`, `agent_name`, `agent_type`, `chunk_order`

---

## 🔍 Example: Multi-Agent Conversation

**Agent 1 (Search) - First chunk:**
```json
{
  "action": "add",  ← Creates new component
  "component": {
    "type": "plan",
    "chunk": "Searching for sales data",
    "id": "comp-1"
  },
  "metadata": {"agent_id": "search-123", ...}
}
```

**Agent 1 (Search) - Second chunk:**
```json
{
  "action": "update",  ← Updates existing
  "component": {
    "type": "text",
    "chunk": "Found 3 documents...",
    "id": "comp-1"  ← Same ID
  },
  "metadata": {"agent_id": "search-123", ...}
}
```

**Agent 2 (Manager) - First chunk:**
```json
{
  "action": "add",  ← New agent = new component
  "component": {
    "type": "text",
    "chunk": "Based on findings...",
    "id": "comp-2"  ← New ID
  },
  "metadata": {"agent_id": "manager-456", ...}
}
```

---

## 📝 Updated Test Script

```python
import grpc
import json
from google.protobuf.json_format import MessageToDict
from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc

channel = grpc.insecure_channel('localhost:50051')
stub = chatbot_pb2_grpc.ChatbotServiceStub(channel)

print("Testing new stream format...")
print("=" * 80)

for chunk in stub.RunAgentTeam(request):
    print(f"\n🔹 Action: {chunk.action}")
    print(f"📦 Component:")
    print(f"   Type: {chunk.component.type}")
    print(f"   ID: {chunk.component.id}")
    print(f"   Content: {chunk.component.chunk[:100]}...")  # First 100 chars
    print(f"👤 Agent: {chunk.metadata.agent_name}")
    print("=" * 80)

    if chunk.component.chunk == "end_of_message":
        print("\n✅ Done!")
        break

channel.close()
```

---

## 🐛 Troubleshooting

### Problem: Import error for `chatbot_pb2`

**Solution:**
```bash
./regenerate_proto.sh
```

### Problem: All chunks show `action: "add"`

**Check:** Is ComponentTracker initialized?
```python
# In team_orchestrator.py line ~453
component_tracker = ComponentTracker(session_id)
```

### Problem: Old format still appearing

**This is OK!** The system has backward compatibility. Old chunks are automatically converted to new format.

---

## 📚 Full Documentation

- **NEW_STREAM_FORMAT.md** - Complete technical documentation
- **API_TO_UI_MAPPING.md** - How to render components in UI
- **STREAM_CHUNK_TYPES.md** - All possible chunk types

---

## 🎨 Frontend Integration

### Component Rendering

```typescript
function renderStreamChunk(chunk: StreamChunk) {
  const { action, component, metadata } = chunk;

  if (action === "add") {
    // Create new UI component
    createComponent(component.id, {
      type: component.type,
      content: component.chunk,
      agent: metadata.agent_name
    });
  } else if (action === "update") {
    // Update existing component
    updateComponent(component.id, {
      content: chunk => chunk + component.chunk  // Append
    });
  }
}
```

### Supported Component Types

- ✅ `text` - Regular text/markdown
- ✅ `plan` - Task descriptions
- ✅ `reasoning` - Agent thinking
- ✅ `chart` - Data visualizations
- ✅ `code` - Code blocks
- ✅ `queue` - Multi-agent workflows
- ✅ `checkpoint` - Phase transitions

---

## ✨ Benefits

✅ **Automatic tracking** - No manual logic for add vs update
✅ **Component persistence** - State survives across sessions
✅ **Type-safe** - Protobuf enforces structure
✅ **UI-ready** - Component types match ai-sdk.dev
✅ **Backward compatible** - Old code still works

---

## 🔄 Rollback (if needed)

If you need to rollback, the old format still works. Just don't use `format_component_event()`:

```python
# Old method still works
event = StreamingFormatter.format_streaming_event(
    agent_name="Agent",
    agent_type="agent",
    chunk="text",
    message_id="id",
    content_type="chunk"
)
```

---

## 📞 Need Help?

Check these files:
1. `NEW_STREAM_FORMAT.md` - Full technical docs
2. `test_real_data.py` - Working example
3. Component tracker source: `src/smart_rag/messaging/component_tracker.py`