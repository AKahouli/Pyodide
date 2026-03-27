# V2 API Final Schema - RunAgentTeam

⚠️ **IMPORTANT**: The V2 API is **only available via gRPC** (port 50051). For HTTP/REST clients, continue using the V1 FastAPI endpoint at `POST /agentic/run_agent_team` (port 8000).

## ✅ Complete V2 Schema

The protobuf file now has the fully simplified V2 schema with **grouped contexts**:

### Final Protobuf Schema

```protobuf
message UserContext {
    string user_id = 1;
    string username = 2;
}

message WorkspaceContext {
    repeated string workspace_ids = 1;
    repeated string workspace_documents = 2;
}

message BrainContext {
    repeated string brain_ids = 1;
    repeated string brain_documents = 2;
}

message FileInput {
    string type = 1;
    string data = 2;
    string url = 3;
}

message AgentSuggestion {
    string id = 1;
    string name = 2;
    string description = 3;
    string prompt = 4;
    repeated Tool tools = 5;
    BrainContext brain_context = 6;
    ChatbotName chatbot_name = 7;
    AgentParams agent_params = 8;
    string agent_type = 9;
    bool save_memory = 10;
}

message RunAgentTeamRequest {
    UserContext user_context = 1;
    string conversation_id = 2;
    string query = 3;
    string chatbot_prompt = 4;
    repeated FileInput file_input = 5;
    repeated AgentSuggestion agents = 6;
    string vectorstore_name = 7;
    WorkspaceContext workspace_context = 8;
    string agent_mode = 9;
}
```

---

## Complete Changes from V1

| Field | V1 (Old) | V2 (New) | Status |
|-------|----------|----------|--------|
| User identity | `user_id`, `username` (separate) | `user_context` (grouped) | ✅ Grouped |
| Session | `session_id` | `conversation_id` | ✅ Renamed |
| Query | `message` | `query` | ✅ Renamed |
| Files | `image_input` | `file_input` | ✅ Renamed |
| Prompt | `manager_prompt` + `chatbot_name` | `chatbot_prompt` (single field) | ✅ Simplified |
| Agent selection | `available_agents`, `available_tools` | ❌ Removed | ✅ Removed |
| Workspace | `brain_ids`, `brain_documents`, `brain_relations` (separate) | `workspace_context` (grouped) | ✅ Grouped |
| Search | `search_web` | ❌ Removed | ✅ Removed |
| AgentSuggestion | `html`, `vectorstore_name`, `brain_relations` | ❌ Removed | ✅ Removed |
| Agent brain data | `brain_ids`, `brain_documents` (separate in agent) | `brain_context` (grouped in agent) | ✅ Grouped |

---

## Test Examples

### gRPC Test (Port 50051)

```bash
grpcurl -plaintext \
  -d '{
    "user_context": {
      "user_id": "user-123",
      "username": "john.doe@example.com"
    },
    "conversation_id": "conv-456",
    "query": "Analyze this data",
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

## Python Client Example

```python
import grpc
from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc

# Create channel
channel = grpc.insecure_channel('localhost:50051')
stub = chatbot_pb2_grpc.ChatbotServiceStub(channel)

# Create user context
user_context = chatbot_pb2.UserContext(
    user_id="user-123",
    username="john.doe@example.com"
)

# Create workspace context (optional)
workspace_context = chatbot_pb2.WorkspaceContext(
    workspace_ids=["ws-001", "ws-002"],
    workspace_documents=["doc-123", "doc-456"]
)

# Create request
request = chatbot_pb2.RunAgentTeamRequest(
    user_context=user_context,
    conversation_id="conv-456",
    query="Analyze this data",
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

## TypeScript Client Example

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
    user_context: {
        user_id: "user-123",
        username: "john.doe@example.com"
    },
    conversation_id: "conv-456",
    query: "Analyze this data",
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

## JSON Schema (for FastAPI)

```json
{
  "user_context": {
    "user_id": "string (required)",
    "username": "string (required)"
  },
  "conversation_id": "string (required)",
  "query": "string (required)",
  "chatbot_prompt": "string (required)",
  "agent_mode": "string (required, 'auto' or 'manual')",
  "vectorstore_name": "string (optional, default: 'default')",
  "workspace_context": {
    "workspace_ids": ["string"],
    "workspace_documents": ["string"]
  },
  "file_input": [
    {
      "type": "string",
      "data": "string",
      "url": "string"
    }
  ],
  "agents": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "prompt": "string",
      "tools": [],
      "brain_context": {
        "brain_ids": ["string"],
        "brain_documents": ["string"]
      },
      "chatbot_name": {"name": "string", "description": "string"},
      "agent_params": {},
      "agent_type": "string",
      "save_memory": false
    }
  ]
}
```

---

## Field Descriptions

### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `user_context` | UserContext | User identity information | See below |
| `user_context.user_id` | string | Unique identifier for the user | `"user-123"` |
| `user_context.username` | string | User's email or display name | `"john.doe@example.com"` |
| `conversation_id` | string | Unique identifier for the conversation | `"conv-456"` |
| `query` | string | The user's message/query | `"Analyze this data"` |
| `chatbot_prompt` | string | System prompt for chatbot behavior | `"You are a helpful assistant..."` |
| `agent_mode` | string | Agent execution mode | `"auto"` or `"manual"` |

### Optional Fields

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `file_input` | FileInput[] | Files/images attached to the message | `null` |
| `agents` | AgentSuggestion[] | Predefined agents to use | `[]` |
| `vectorstore_name` | string | Name of the vector store | `"default"` |
| `workspace_context` | WorkspaceContext | Workspace documents and IDs | `null` |
| `workspace_context.workspace_ids` | string[] | List of workspace IDs | `[]` |
| `workspace_context.workspace_documents` | string[] | List of document IDs | `[]` |

---

## Minimal Request Example

```json
{
  "user_context": {
    "user_id": "user-123",
    "username": "john.doe@example.com"
  },
  "conversation_id": "conv-456",
  "query": "Hello!",
  "chatbot_prompt": "You are a helpful assistant.",
  "agent_mode": "auto"
}
```

---

## Full Request Example

```json
{
  "user_context": {
    "user_id": "user-123",
    "username": "john.doe@example.com"
  },
  "conversation_id": "conv-456",
  "query": "Analyze this data and create a report",
  "chatbot_prompt": "You are a data analyst expert specializing in business intelligence.",
  "agent_mode": "auto",
  "vectorstore_name": "company_docs",
  "workspace_context": {
    "workspace_ids": ["ws-001", "ws-002"],
    "workspace_documents": ["doc-123", "doc-456", "doc-789"]
  },
  "file_input": [
    {
      "type": "image/png",
      "data": "base64_encoded_data",
      "url": ""
    }
  ],
  "agents": []
}
```

---

## Benefits of Grouped Contexts

### Before V2:
```json
{
  "user_id": "user-123",
  "username": "john.doe@example.com",
  "brain_ids": ["ws-001"],
  "brain_documents": ["doc-123"],
  ...
}
```

### After V2:
```json
{
  "user_context": {
    "user_id": "user-123",
    "username": "john.doe@example.com"
  },
  "workspace_context": {
    "workspace_ids": ["ws-001"],
    "workspace_documents": ["doc-123"]
  },
  ...
}
```

**Benefits:**
- ✅ Better organization - Related fields grouped together
- ✅ Clearer intent - "context" objects are explicit groupings
- ✅ Easier to extend - Add fields to contexts without polluting root
- ✅ Type-safe - Contexts are typed objects in all languages
- ✅ More maintainable - Changes to contexts are isolated

---

## Endpoints Available

| Protocol | Endpoint | Port | URL |
|----------|----------|------|-----|
| **gRPC (V2)** | `chatbot.ChatbotService/RunAgentTeam` | 50051 | `localhost:50051` |
| **FastAPI (V1)** | `POST /agentic/run_agent_team` | 8000 | `http://localhost:8000/agentic/run_agent_team` |

---

## Summary

✅ **user_context** - Groups user_id + username
✅ **workspace_context** - Groups workspace_ids + workspace_documents
✅ **brain_context** - Groups brain_ids + brain_documents (in AgentSuggestion)
✅ **chatbot_prompt** - Single field for chatbot behavior
✅ **conversation_id** - More descriptive than session_id
✅ **query** - More descriptive than message
✅ **file_input** - More generic than image_input (supports any file type)
✅ **Simplified AgentSuggestion** - Removed html, vectorstore_name, brain_relations
✅ **Simplified** - Removed 8+ unused fields from V1
✅ **Type-safe** - Strong typing with protobuf and Pydantic

**gRPC V2 endpoint is ready with the final schema!** 🚀

---

## Quick Test Command

```bash
# gRPC V2 Test
grpcurl -plaintext \
  -d '{"user_context":{"user_id":"test","username":"test@example.com"},"conversation_id":"conv1","query":"Hi","chatbot_prompt":"You are helpful","agent_mode":"auto"}' \
  localhost:50051 \
  chatbot.ChatbotService/RunAgentTeam
```