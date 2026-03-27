# Final V2 API Schema - RunAgentTeam

⚠️ **IMPORTANT**: The V2 API is **only available via gRPC** (port 50051). For HTTP/REST clients, continue using the V1 FastAPI endpoint at `POST /agentic/run_agent_team` (port 8000).

## ✅ Completed Changes

The gRPC protobuf file now contains **ONLY** the V2 endpoint with the following schema:

### V2 Schema

```protobuf
message RunAgentTeamRequest {
    string user_id = 1;
    string username = 2;
    string conversation_id = 3;
    string message = 4;
    string chatbot_prompt = 5;
    repeated ImageInput image_input = 6;
    repeated AgentSuggestion agents = 7;
    string vectorstore_name = 8;
    WorkspaceContext workspace_context = 9;
    string agent_mode = 10;
}

message WorkspaceContext {
    repeated string workspace_ids = 1;
    repeated string workspace_documents = 2;
}
```

---

## Changes Summary

| Field | V1 (Old) | V2 (New) | Status |
|-------|----------|----------|--------|
| User identity | `user_id` only | `user_id` + `username` | ✅ Added |
| Session | `session_id` | `conversation_id` | ✅ Renamed |
| Prompt | `manager_prompt` + `chatbot_name` | `chatbot_prompt` (single field) | ✅ Simplified |
| Agent selection | `available_agents`, `available_tools` | ❌ Removed | ✅ Removed |
| Workspace | `brain_ids`, `brain_documents`, `brain_relations` (separate) | `workspace_context` (grouped) | ✅ Renamed & Grouped |
| Search | `search_web` | ❌ Removed | ✅ Removed |

---

## Test Examples

### gRPC Test (Port 50051)

```bash
grpcurl -plaintext \
  -d '{
    "user_id": "user-123",
    "username": "john.doe@example.com",
    "conversation_id": "conv-456",
    "message": "Analyze this data",
    "chatbot_prompt": "You are a data analyst expert. Help users analyze and visualize data.",
    "agent_mode": "auto",
    "vectorstore_name": "vectorstoredev3",
    "workspace_context": {
      "workspace_ids": ["ws-001", "ws-002"],
      "workspace_documents": ["doc-123", "doc-456"]
    },
    "agents": []
  }' \
  localhost:50051 \
  chatbot.ChatbotService/RunAgentTeam
```

---

## Field Descriptions

### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `user_id` | string | Unique identifier for the user | `"user-123"` |
| `username` | string | User's email or display name | `"john.doe@example.com"` |
| `conversation_id` | string | Unique identifier for the conversation | `"conv-456"` |
| `message` | string | The user's message/query | `"Analyze this data"` |
| `chatbot_prompt` | string | System prompt for the chatbot behavior | `"You are a helpful assistant..."` |
| `agent_mode` | string | Agent execution mode | `"auto"` or `"manual"` |

### Optional Fields

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `image_input` | ImageInput[] | Images attached to the message | `null` |
| `agents` | AgentSuggestion[] | Predefined agents to use | `[]` |
| `vectorstore_name` | string | Name of the vector store | `"default"` |
| `workspace_context` | WorkspaceContext | Workspace documents and IDs | `null` |

---

## Protobuf Service Definition

```protobuf
service ChatbotService {
    // Server streaming: client sends 1 request, server streams N responses
    rpc ChatWithADK(ChatWithADKRequest) returns (stream StreamChunk);
    rpc RunAgentTeam(RunAgentTeamRequest) returns (stream StreamChunk);
}
```

**Note:** Only ONE `RunAgentTeam` method exists now (V2 schema).

---

## Python Client Example

```python
import grpc
from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc

# Create channel
channel = grpc.insecure_channel('localhost:50051')
stub = chatbot_pb2_grpc.ChatbotServiceStub(channel)

# Create workspace context (optional)
workspace_context = chatbot_pb2.WorkspaceContext(
    workspace_ids=["ws-001", "ws-002"],
    workspace_documents=["doc-123", "doc-456"]
)

# Create request
request = chatbot_pb2.RunAgentTeamRequest(
    user_id="user-123",
    username="john.doe@example.com",
    conversation_id="conv-456",
    message="Analyze this data",
    chatbot_prompt="You are a data analyst expert.",
    agent_mode="auto",
    vectorstore_name="vectorstoredev3",
    workspace_context=workspace_context,
    agents=[]
)

# Stream responses
print("Streaming responses:")
for chunk in stub.RunAgentTeam(request):
    if chunk.content_type == "final_response":
        print(f"\n✅ Stream ended")
        break
    print(f"[{chunk.agent_type}] {chunk.chunk}", end="", flush=True)
```

---

## TypeScript Client Example (BackChatBot)

```typescript
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

// Load proto
const packageDefinition = protoLoader.loadSync('./proto/chatbot.proto');
const proto = grpc.loadPackageDefinition(packageDefinition) as any;

// Create client
const client = new proto.chatbot.ChatbotService(
    'api-metachatbot-adk:50051',
    grpc.credentials.createInsecure()
);

// Create request
const request = {
    user_id: "user-123",
    username: "john.doe@example.com",
    conversation_id: "conv-456",
    message: "Analyze this data",
    chatbot_prompt: "You are a data analyst expert.",
    agent_mode: "auto",
    vectorstore_name: "vectorstoredev3",
    workspace_context: {
        workspace_ids: ["ws-001", "ws-002"],
        workspace_documents: ["doc-123", "doc-456"]
    },
    agents: []
};

// Stream responses
const stream = client.RunAgentTeam(request);

stream.on('data', (chunk: any) => {
    if (chunk.content_type === 'final_response') {
        console.log('\n✅ Stream ended');
        return;
    }
    process.stdout.write(`[${chunk.agent_type}] ${chunk.chunk}`);
});

stream.on('end', () => {
    console.log('\nStream complete');
});

stream.on('error', (error: Error) => {
    console.error('Error:', error);
});
```

---

## Endpoints Available

| Protocol | Endpoint | Port | URL |
|----------|----------|------|-----|
| **gRPC (V2)** | `chatbot.ChatbotService/RunAgentTeam` | 50051 | `localhost:50051` |
| **FastAPI (V1)** | `POST /agentic/run_agent_team` | 8000 | `http://localhost:8000/agentic/run_agent_team` |

**Note:** V2 schema is only available via gRPC. FastAPI continues to use V1 schema.

---

## Restart Server

To apply all changes:

```bash
# Restart your server in PyCharm or terminal
python main.py
```

You should see:
```
INFO: ✅ gRPC server task started (running in background)
INFO: ✅ [gRPC] Server started successfully on 0.0.0.0:50051
INFO: [gRPC] Available services:
INFO:   - chatbot.ChatbotService/ChatWithADK
INFO:   - chatbot.ChatbotService/RunAgentTeam
```

---

## Verify gRPC is Running

```bash
# Check port
lsof -i :50051

# List services
grpcurl -plaintext localhost:50051 list

# Should show:
# chatbot.ChatbotService

# Describe service
grpcurl -plaintext localhost:50051 describe chatbot.ChatbotService

# Should show RunAgentTeam method
```

---

## Summary

✅ **Protobuf file cleaned** - Only V2 schema remains
✅ **chatbot_prompt** - Single field instead of manager_prompt + chatbot_name
✅ **workspace_context** - Grouped workspace_ids + workspace_documents
✅ **username added** - User identity included
✅ **conversation_id** - More descriptive than session_id
✅ **Simplified schema** - Removed unused fields

**gRPC V2 endpoint is ready to use!** 🚀