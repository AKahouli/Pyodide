# V2 API Guide - RunAgentTeam

## Overview

⚠️ **IMPORTANT**: The V2 API is **only available via gRPC** (port 50051). For HTTP/REST clients, continue using the V1 FastAPI endpoint at `POST /agentic/run_agent_team` (port 8000).

The V2 endpoint for `RunAgentTeam` provides a simplified and cleaner API schema with the following improvements:

### Changes from V1 to V2

| Feature | V1 | V2 |
|---------|----|----|
| **User Info** | Only `user_id` | Added `username` + `user_id` |
| **Session** | `session_id` | Renamed to `conversation_id` (more descriptive) |
| **Agent Selection** | `available_agents`, `available_tools` | ❌ Removed (not used) |
| **Workspace** | `brain_ids`, `brain_documents`, `brain_relations` (separate) | `workspace_context` (combined workspace_ids + workspace_documents) |
| **Search** | `search_web` | ❌ Removed |

---

## V2 Request Schema

### Pydantic Model (Python)

```python
from pydantic import BaseModel
from typing import List, Optional, Dict

class WorkspaceContext(BaseModel):
    workspace_ids: List[str]
    workspace_documents: List[str]

class RunAgentTeamRequestV2(BaseModel):
    user_id: str
    username: str
    conversation_id: str
    message: str
    image_input: Optional[List[Dict]] = None
    manager_prompt: str = "You are a manager agent that coordinates tasks between specialized agents."
    chatbot_name: dict
    agents: Optional[List[AgentSuggestion]] = []
    vectorstore_name: str = "default"
    workspace_context: Optional[WorkspaceContext] = None
    agent_mode: str
```

### Example JSON Request

```json
{
  "user_id": "user-123",
  "username": "john.doe@example.com",
  "conversation_id": "conv-456",
  "message": "Analyze this data and create a report",
  "agent_mode": "auto",
  "chatbot_name": {
    "name": "DataAnalyzer",
    "description": "AI agent for data analysis"
  },
  "vectorstore_name": "company_docs",
  "workspace_context": {
    "workspace_ids": ["ws-001", "ws-002"],
    "workspace_documents": ["doc-123", "doc-456"]
  },
  "agents": []
}
```

---

## Testing V2 Endpoint (gRPC Only)

### gRPC - Port 50051

**Service:** `chatbot.ChatbotService/RunAgentTeamV2`

#### Using grpcurl

```bash
grpcurl -plaintext \
  -d '{
    "user_id": "user-123",
    "username": "john.doe@example.com",
    "conversation_id": "conv-456",
    "message": "Hello, test message",
    "agent_mode": "auto",
    "chatbot_name": {
      "name": "TestBot",
      "description": "Test chatbot"
    },
    "vectorstore_name": "vectorstoredev3",
    "workspace_context": {
      "workspace_ids": ["ws-001"],
      "workspace_documents": ["doc-123"]
    },
    "agents": []
  }' \
  localhost:50051 \
  chatbot.ChatbotService/RunAgentTeamV2
```

#### Using Python gRPC Client

```python
import grpc
from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc

# Create channel
channel = grpc.insecure_channel('localhost:50051')
stub = chatbot_pb2_grpc.ChatbotServiceStub(channel)

# Create workspace context
workspace_context = chatbot_pb2.WorkspaceContext(
    workspace_ids=["ws-001"],
    workspace_documents=["doc-123"]
)

# Create chatbot name
chatbot_name = chatbot_pb2.ChatbotName(
    name="TestBot",
    description="Test chatbot"
)

# Create V2 request
request = chatbot_pb2.RunAgentTeamRequestV2(
    user_id="user-123",
    username="john.doe@example.com",
    conversation_id="conv-456",
    message="Hello, test message",
    agent_mode="auto",
    chatbot_name=chatbot_name,
    vectorstore_name="vectorstoredev3",
    workspace_context=workspace_context,
    agents=[]
)

# Stream responses
for chunk in stub.RunAgentTeamV2(request):
    print(f"[{chunk.agent_type}] {chunk.chunk}")
```

---

## Comparison: V1 vs V2

### V1 Request (Old)
```json
{
  "user_id": "user-123",
  "session_id": "conv-456",
  "message": "...",
  "agent_mode": "auto",
  "chatbot_name": {...},
  "vectorstore_name": "...",
  "brain_ids": ["ws-001"],
  "brain_documents": ["doc-123"],
  "brain_relations": {"nodes": [], "relationships": []},
  "available_agents": [],
  "available_tools": [],
  "search_web": false,
  "agents": []
}
```

### V2 Request (New)
```json
{
  "user_id": "user-123",
  "username": "john.doe@example.com",
  "conversation_id": "conv-456",
  "message": "...",
  "agent_mode": "auto",
  "chatbot_name": {...},
  "vectorstore_name": "...",
  "workspace_context": {
    "workspace_ids": ["ws-001"],
    "workspace_documents": ["doc-123"]
  },
  "agents": []
}
```

**Benefits:**
- ✅ Cleaner schema (7 fewer fields)
- ✅ More descriptive naming (`conversation_id` vs `session_id`)
- ✅ Better organization (`workspace_context` groups related fields)
- ✅ Includes user identity (`username`)

---

## Backward Compatibility

**V1 endpoints are still available:**
- `POST /agentic/run_agent_team` (V1)
- `chatbot.ChatbotService/RunAgentTeam` (gRPC V1)

Both V1 and V2 use the same underlying service, so they have identical functionality.

---

## Testing Checklist

### FastAPI V2
- [ ] Start server: `python main.py`
- [ ] Test basic request with minimal fields
- [ ] Test with workspace_context
- [ ] Test with agents list
- [ ] Verify SSE streaming works

### gRPC V2
- [ ] Verify server started on port 50051
- [ ] List services: `grpcurl -plaintext localhost:50051 list`
- [ ] Test with grpcurl
- [ ] Test with Python client
- [ ] Verify streaming responses

---

## Quick Test Script

Save as `test_v2_grpc.sh`:

```bash
#!/bin/bash

echo "Testing V2 gRPC Endpoint"
echo "========================"

# Test gRPC V2
echo ""
echo "Testing gRPC V2..."
grpcurl -plaintext \
  -d '{
    "user_id": "test-user",
    "username": "test@example.com",
    "conversation_id": "test-conv",
    "message": "Hello V2!",
    "agent_mode": "auto",
    "chatbot_name": {"name": "TestBot", "description": ""},
    "vectorstore_name": "default"
  }' \
  localhost:50051 \
  chatbot.ChatbotService/RunAgentTeamV2 | head -20

echo ""
echo "Done!"
```

Run with: `chmod +x test_v2_grpc.sh && ./test_v2_grpc.sh`

---

## Migration Guide (V1 → V2)

If you're migrating from V1 to V2, here's the mapping:

```python
# V1 Request
v1_request = {
    "user_id": "...",
    "session_id": "...",             # ← Rename to conversation_id
    "message": "...",
    "agent_mode": "...",
    "chatbot_name": {...},
    "vectorstore_name": "...",
    "brain_ids": [...],              # ← Combine into workspace_context
    "brain_documents": [...],        # ← Combine into workspace_context
    "brain_relations": {...},        # ← Remove
    "available_agents": [...],       # ← Remove
    "available_tools": [...],        # ← Remove
    "search_web": False,             # ← Remove
    "agents": [...]
}

# V2 Request
v2_request = {
    "user_id": "...",
    "username": "NEW FIELD",         # ← Add username
    "conversation_id": "...",        # ← Renamed from session_id
    "message": "...",
    "agent_mode": "...",
    "chatbot_name": {...},
    "vectorstore_name": "...",
    "workspace_context": {           # ← New grouped field
        "workspace_ids": [...],
        "workspace_documents": [...]
    },
    "agents": [...]
}
```

---

## Summary

✅ **gRPC V2 Method Created:** `chatbot.ChatbotService/RunAgentTeamV2`
✅ **Protobuf Updated:** V2 messages added to `proto/chatbot.proto`
✅ **Backward Compatible:** V1 FastAPI endpoint still available
✅ **Same Functionality:** Uses same service layer internally

**Ready to test!** gRPC V2 endpoint is available on port 50051. For HTTP/REST clients, use the V1 FastAPI endpoint on port 8000.