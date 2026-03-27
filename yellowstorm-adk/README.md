# Yellowstorm ADK

AI-powered multi-agent backend API built on [Google's Agent Development Kit (ADK)](https://github.com/google/adk-python). It orchestrates teams of specialized AI agents that collaborate to handle complex user queries via both REST/SSE and gRPC interfaces.

## Architecture Overview 

```
Client (Web UI / gRPC client)
    │
    ├── REST/SSE (FastAPI :8001)
    │       ├── /chatbots/*        → ChatRAG Service
    │       ├── /agentic/*         → Agent Team / Single Agent / Attribute Extraction
    │       ├── /similarity-search → Azure AI Search
    │       └── /playbook/*        → Playbook Execution
    │
    └── gRPC (:50051)
            ├── RunAgentTeam             → Streaming agent team responses
            └── GenerateConversationName → Conversation name generation
```

The core of the system is a **Manager Agent** that receives user queries and dynamically delegates tasks to specialized sub-agents (search, operator, report writer, HTML diagram, etc.), each equipped with domain-specific tools.

## Key Features

- **Multi-Agent Orchestration** -- A manager agent dynamically creates and coordinates specialized sub-agents using Google ADK's `Runner` and `Agent` primitives. Supports sequential and parallel workflows.
- **Dual API** -- FastAPI (REST/SSE) for web clients alongside a gRPC server for high-performance protobuf-based streaming.
- **RAG Pipeline** -- Similarity search via Azure AI Search with hybrid (vector + keyword) and multilingual search support.
- **Agent Tools** -- Search (document/web via Linkup), calculator, Python code interpreter (sandboxed), Snowflake SQL, DataViz charts, FormViz forms, Excel (MCP), HTML diagram generation.
- **Agent Memory** -- Persistent agent memory via [mem0](https://github.com/mem0ai/mem0) backed by Azure AI Search.
- **Playbook Execution** -- Multi-step playbook workflows with per-step streaming.
- **Attribute Extraction** -- Extract structured data from documents asynchronously with webhook delivery. Supports batch processing via Celery.
- **Session Persistence** -- PostgreSQL-backed sessions using Google ADK's `DatabaseSessionService`.
- **Observability** -- Langfuse LLM tracing, Azure Application Insights, Elasticsearch, DataDog, and PostgreSQL centralized logging.
- **Security** -- JWT authentication, hardened Docker images with Trivy/Bandit/pip-audit/Safety scanning, CIS Docker Benchmark compliance.
- **CI/CD** -- GitHub Actions pipeline with tests, SonarCloud analysis, semantic versioning, Docker build/push to Azure Container Registry, and automated deployment.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | FastAPI, Uvicorn, gRPC |
| AI Orchestration | Google ADK, LiteLLM (multi-provider LLM routing) |
| Vector Search | Azure AI Search, OpenAI Embeddings |
| Storage | Azure Data Lake, PostgreSQL, Redis |
| Background Tasks | Celery (Redis broker) |
| Graph DB | Neo4j |
| LLM Observability | Langfuse |
| Monitoring | Azure Application Insights, Elasticsearch, DataDog |
| Containerization | Docker (multi-stage hardened build) |
| CI/CD | GitHub Actions, SonarCloud, Azure Container Registry |

## Project Structure

```
├── main.py                         # Application entry point (FastAPI + gRPC startup)
├── Dockerfile                      # Multi-stage hardened Docker build
├── docker-compose.yaml             # Dev composition (API + Celery worker)
├── requirements.txt                # Python dependencies
├── pytest.ini                      # Test configuration
├── sonar-project.properties        # SonarCloud config
├── grpc/
│   ├── proto/chatbot.proto         # Protobuf service & message definitions
│   ├── generate_proto.py           # Proto code generation script
│   └── documentation-grpc/         # gRPC integration guides
└── src/
    ├── config/settings.py          # Pydantic-settings configuration
    ├── routers/                    # FastAPI route handlers
    │   ├── chatbot.py              # Chat & agentic endpoints
    │   ├── similarity_search.py    # Similarity search endpoint
    │   └── playbook.py             # Playbook execution endpoints
    ├── grpc_server/                # gRPC server & ChatbotServicer
    ├── schema/                     # Pydantic request/response models
    ├── authentification/           # JWT authentication
    ├── middleware/                  # CORS, tracing, correlation ID, context binding
    ├── logger/                     # Elasticsearch, PostgreSQL, App Insights logging
    ├── infrastructure/             # Celery app configuration
    ├── similarity_search/          # Azure AI Search, hybrid/vector search, embeddings
    ├── attribute_extraction/       # Structured data extraction with webhooks
    └── smart_rag/                  # Core AI engine
        ├── agents/
        │   ├── core/               # Agent runner, helpers, repository
        │   ├── factories/          # Agent & tool factories
        │   ├── generators/         # Agent suggestion generator
        │   └── tools/              # Tool management & delegation
        ├── core/                   # Service layer (AgentTeam, ChatRAG, SingleAgent, Skills)
        ├── engines/
        │   ├── multi_agent/        # Multi-agent workflow processor & streaming
        │   └── traditional/        # Traditional RAG orchestrator
        ├── infrastructure/
        │   ├── factories/          # LLM factory (LiteLLM)
        │   ├── memory/             # mem0 memory service
        │   ├── session/            # Session & citation management
        │   ├── monitoring/         # Trace recording
        │   ├── processing/         # Prompt processing, callbacks, plugins
        │   └── external/           # MCP helper, message helper
        ├── messaging/              # Component tracker, streaming formatters
        ├── playbook_dir/           # Playbook step & full playbook execution
        └── tools/
            ├── search/             # Search toolkit, web search
            ├── utilities/          # Calculator, code interpreter, plan generator, ESG, Neo4j
            └── infrastructure/     # Tool descriptions & common helpers
```

## API Endpoints

### Chatbot

| Method | Path | Description |
|---|---|---|
| `POST` | `/chatbots/chatWithADK` | Chat with ADK (streaming SSE) |
| `POST` | `/chatbots/chat_completion` | Simple LLM chat completion |

### Agentic

| Method | Path | Description |
|---|---|---|
| `POST` | `/agentic/run_agent_team` | Run a multi-agent team (streaming SSE) |
| `POST` | `/agentic/run_single_agent` | Run a single agent directly (streaming SSE) |
| `POST` | `/agentic/config_agents_with_skills` | Configure an agent with skills and save to memory |
| `DELETE` | `/agentic/clear_agent_memory` | Clear all memories for a specific agent |
| `POST` | `/agentic/attribute_extraction` | Async attribute extraction with webhook callback |
| `POST` | `/agentic/batch_attribute_extraction` | Batch extraction via Celery |
| `GET` | `/agentic/batch_status/{batch_job_id}` | Check batch processing status |

### Similarity Search

| Method | Path | Description |
|---|---|---|
| `POST` | `/similarity-search/similarity-search-with-score` | Search for similar documents with relevance scores |

### Playbook

| Method | Path | Description |
|---|---|---|
| `POST` | `/playbook/execute_playbook_step` | Execute a single playbook step (streaming SSE) |
| `POST` | `/playbook/execute_playbook` | Execute a complete multi-step playbook (streaming SSE) |

### gRPC Services

| Service | RPC | Type | Description |
|---|---|---|---|
| `ChatbotService` | `RunAgentTeam` | Server streaming | Run an agent team with protobuf streaming |
| `ChatbotService` | `GenerateConversationName` | Unary | Generate a conversation name from a query |

## Getting Started

### Prerequisites

- Python 3.10+
- PostgreSQL
- Redis
- Azure AI Search instance
- LiteLLM proxy (or direct LLM API keys)

### Installation

```bash
# Clone the repository
git clone https://github.com/YellowsysOrg/Yellowstorm-adk.git
cd Yellowstorm-adk

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Configuration

Copy the example environment file and fill in the required values:

```bash
cp .env.example .env
```

Key configuration groups:

| Group | Variables |
|---|---|
| Application | `HOST`, `PORT`, `UVICORN_WORKERS`, `TIMEOUT_KEEP_ALIVE` |
| LLM | `LITELLM_API_BASE_URL`, `LITELLM_API_SECRET_KEY` |
| Azure Storage | `AZURE_STORAGE_ACCOUNT`, `AZURE_DATALAKE_CONNECTION_STRING` |
| Database | `DATABASE_URL` (PostgreSQL) |
| Redis | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` |
| Search | `VECTORSTORE_NAME`, `EMBEDDING_MODEL`, `AZURE_AI_SEARCH_*` |
| Auth | `AUTH_USERNAME`, `AUTH_PASSWORD`, `SECRET_KEY`, `ALGORITHM` |
| Observability | `LANGFUSE_HOST`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY` |
| gRPC | `GRPC_ENABLED` (default: `true`), `GRPC_PORT` (default: `50051`) |

### Running

```bash
# Start the API (REST on port 8001 + gRPC on port 50051)
python -m main

# Or with uvicorn directly
uvicorn main:app --host 0.0.0.0 --port 8001
```

### Running with Docker

```bash
# Build the image
docker build -t yellowstorm-adk .

# Run with docker-compose (API + Celery worker) 
docker-compose up -d
```

The Docker Compose configuration exposes:
- **REST API**: port `3017` -> `8001`
- **gRPC**: port `50051` -> `50051`

### Running the Celery Worker

For batch attribute extraction:

```bash
celery -A src.infrastructure.celery_app.celery_app worker \
  --loglevel=info \
  --queues=attribute_extraction \
  --pool=threads \
  --concurrency=4
```

## gRPC & Protobuf Guide

The gRPC API runs alongside FastAPI on a separate port and shares the same business logic. It provides high-performance protobuf-based streaming as an alternative to REST/SSE.

### Configuration

```bash
# .env
GRPC_ENABLED=true    # Enable/disable gRPC server (default: true)
GRPC_PORT=50051      # gRPC port (default: 50051)
```

Set `GRPC_ENABLED=false` to run in REST-only mode.

### Proto Definition

The service contract is defined in `grpc/proto/chatbot.proto` using proto3 syntax. It lives under the `chatbot` package.

**Services:**

```protobuf
service ChatbotService {
    // Server-streaming: run a multi-agent team and receive component chunks
    rpc RunAgentTeam(RunAgentTeamRequest) returns (stream StreamChunk);

    // Unary: generate a short conversation name from a query
    rpc GenerateConversationName(GenerateConversationNameRequest)
        returns (GenerateConversationNameResponse);
}
```

### Regenerating Protobuf Code

After editing `grpc/proto/chatbot.proto`, regenerate the Python stubs:

```bash
# Using the Python script (recommended)
python grpc/generate_proto.py

# Or using the shell wrapper
./grpc/regenerate_proto.sh
```

This produces two files in `src/grpc_generated/`:

| File | Contents |
|---|---|
| `chatbot_pb2.py` | Message classes (request/response types) |
| `chatbot_pb2_grpc.py` | Service stubs and servicer base classes |

The generator automatically fixes the import path from `import chatbot_pb2` to `from src.grpc_generated import chatbot_pb2`.

> Restart the server after regenerating for changes to take effect.

### Request Schema

#### `RunAgentTeamRequest`

```protobuf
message RunAgentTeamRequest {
    UserContext user_context = 1;          // user_id + username
    string conversation_id = 2;            // Session/conversation identifier
    string query = 3;                      // User message
    repeated FileInput file_input = 5;     // Optional file attachments (type, data, url)
    repeated Agent agents = 6;             // Agent definitions (must include one with agent_type="manager")
    repeated WorkspaceContext workspace_context = 8;  // Document workspaces
    string agent_mode = 9;                 // "manual" or "auto"
}
```

**Key rules:**
- The `agents` list **must** contain at least one agent with `agent_type = "manager"`. Its `chatbot.model` and `prompt` are used for the manager LLM.
- Each `Agent` carries its own `Chatbot` with a single `model` field containing the full LiteLLM identifier (e.g., `"anthropic/claude-sonnet-4-5"`, `"azure/gpt-4.1"`).
- `workspace_context` is a repeated field supporting multiple workspaces, each with a `workspace_id` and a list of `Document` objects.

#### `Agent`

```protobuf
message Agent {
    string id = 1;
    string name = 2;
    string description = 3;
    string prompt = 4;
    repeated Tool tools = 5;                 // Tools: search, calculator, web_search, code_interpreter, etc.
    repeated WorkspaceContext brain_context = 6;  // Agent-specific document workspaces
    Chatbot chatbot = 7;                     // LLM model config
    AgentParams agent_params = 8;            // Extra params (max_tokens, temperature, etc.)
    string agent_type = 9;                   // "manager", "simple", etc.
    bool save_memory = 10;                   // Persist agent memory across sessions
}
```

#### `GenerateConversationNameRequest`

```protobuf
message GenerateConversationNameRequest {
    string query = 1;    // User query to derive a name from
    string model = 2;    // LiteLLM model identifier
}
```

### Response Schema -- StreamChunk

Every streamed message is a `StreamChunk`:

```protobuf
message StreamChunk {
    string action = 1;       // "add", "update", or "delete"
    Component component = 2; // The typed UI component
    Metadata metadata = 3;   // message_id + agent_id
    Usage usage = 4;         // Token consumption (optional, sent at end)
}
```

**Actions:**
- `add` -- First chunk from an agent/component (create a new UI block)
- `update` -- Subsequent chunks for the same component (append/replace content)
- `delete` -- Remove a previously added component

#### Component Types

The `Component` message uses a `oneof` to carry exactly one typed payload:

| Type | Proto Message | Key Fields | Description |
|---|---|---|---|
| `text` | `TextComponent` | `content` | Markdown/text content |
| `code` | `CodeComponent` | `content`, `language`, `filename` | Code block |
| `reasoning` | `ReasoningComponent` | `content` | Internal agent thought process |
| `plan` | `PlanComponent` | `title`, `steps[]`, `status` | Execution plan with step-by-step agent assignments |
| `queue` | `QueueComponent` | `title`, `items[]` | Agent task queue |
| `checkpoint` | `CheckpointComponent` | `label` | Phase transition marker |
| `chart` | `ChartComponent` | `title`, `data`, `config`, `xAxisKey`, `series` | Data visualization (JSON strings) |
| `task` | `TaskComponent` | `title`, `items[]`, `status` | Task list |
| `error` | `ErrorComponent` | `title`, `content` | Error message |
| `sources` | `SourcesComponent` | `sources[]` (title + url) | Web search citations |
| `sandbox` | `SandboxComponent` | `code`, `output`, `error`, `output_available` | Python code execution results |
| `web_preview` | `WebPreviewComponent` | `content` | HTML/CSS/JS preview |
| `artifact` | `ArtifactComponent` | `file_path`, `filename` | Generated file |
| `citation` | `CitationComponent` | `parent_id`, `text_source` or `image_source` | Document citation with page content |

#### Usage (Token Tracking)

```protobuf
message Usage {
    int32 input_tokens = 1;
    int32 output_tokens = 2;
    int32 total_tokens = 3;
    string model = 4;         // Model that was used (e.g., "gpt-4.1")
}
```

A usage-only chunk (no component) is sent at the end of the stream to report token consumption.

### Typical Stream Flow

```
1. StreamChunk { action:"add",  component: plan{...} }       ← Agent plan
2. StreamChunk { action:"add",  component: queue{...} }      ← Task queue
3. StreamChunk { action:"add",  component: reasoning{...} }  ← Agent thinking / searching
4. StreamChunk { action:"add",  component: text{...} }       ← First text block
5. StreamChunk { action:"update", component: text{...} }     ← Streaming text tokens
   ...
6. StreamChunk { action:"add",  component: sources{...} }    ← Web citations (if any)
7. StreamChunk { action:"add",  component: citation{...} }   ← Document citations (if any)
8. StreamChunk { usage: {...} }                               ← Token usage summary
9. (stream ends)
```

### Testing with grpcurl

```bash
# Install grpcurl
brew install grpcurl        # macOS
# or: go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest

# List available services
grpcurl -plaintext localhost:50051 list

# Describe the service
grpcurl -plaintext localhost:50051 describe chatbot.ChatbotService

# Describe a message type
grpcurl -plaintext localhost:50051 describe chatbot.RunAgentTeamRequest

# Call RunAgentTeam (server streaming)
grpcurl -plaintext \
  -d '{
    "user_context": {
      "user_id": "user-123",
      "username": "user@example.com"
    },
    "conversation_id": "conv-456",
    "query": "Summarize the Q4 report",
    "agent_mode": "manual",
    "agents": [
      {
        "id": "mgr-1",
        "name": "Manager",
        "prompt": "You are a manager agent that coordinates tasks.",
        "agent_type": "manager",
        "chatbot": { "model": "azure/gpt-4.1" }
      },
      {
        "id": "search-1",
        "name": "Search Agent",
        "description": "Searches internal documents",
        "prompt": "You are a search agent",
        "agent_type": "simple",
        "tools": [{ "name": "search", "top_k": 5 }],
        "chatbot": { "model": "azure/gpt-4.1" }
      }
    ],
    "workspace_context": [
      {
        "workspace_id": "ws-789",
        "workspace_documents": [
          { "_id": "doc-1", "filename": "Q4_Report.pdf", "filepath": "ws-789/doc-1.pdf" }
        ]
      }
    ]
  }' \
  localhost:50051 \
  chatbot.ChatbotService/RunAgentTeam

# Call GenerateConversationName (unary)
grpcurl -plaintext \
  -d '{ "query": "What are the Q4 sales figures?", "model": "azure/gpt-4.1" }' \
  localhost:50051 \
  chatbot.ChatbotService/GenerateConversationName
```

### Python Client Example

```python
import grpc
from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc

# Connect to the server
channel = grpc.insecure_channel("localhost:50051")
stub = chatbot_pb2_grpc.ChatbotServiceStub(channel)

# Build the request
request = chatbot_pb2.RunAgentTeamRequest(
    user_context=chatbot_pb2.UserContext(
        user_id="user-123",
        username="user@example.com"
    ),
    conversation_id="conv-456",
    query="Summarize the Q4 report",
    agent_mode="manual",
    agents=[
        chatbot_pb2.Agent(
            id="mgr-1",
            name="Manager",
            prompt="You are a manager agent.",
            agent_type="manager",
            chatbot=chatbot_pb2.Chatbot(model="azure/gpt-4.1"),
        ),
        chatbot_pb2.Agent(
            id="search-1",
            name="Search Agent",
            prompt="You are a search agent.",
            agent_type="simple",
            tools=[chatbot_pb2.Tool(name="search", top_k=5)],
            chatbot=chatbot_pb2.Chatbot(model="azure/gpt-4.1"),
        ),
    ],
    workspace_context=[
        chatbot_pb2.WorkspaceContext(
            workspace_id="ws-789",
            workspace_documents=[
                chatbot_pb2.Document(
                    _id="doc-1",
                    filename="Q4_Report.pdf",
                    filepath="ws-789/doc-1.pdf",
                )
            ],
        )
    ],
)

# Stream responses
for chunk in stub.RunAgentTeam(request):
    # Check which component type was sent
    component = chunk.component
    component_type = component.WhichOneof("data")

    if component_type == "text":
        print(component.text.content, end="", flush=True)
    elif component_type == "plan":
        print(f"\n[Plan] {component.plan.title}")
        for step in component.plan.steps:
            print(f"  - {step.task} ({step.agent})")
    elif component_type == "reasoning":
        print(f"  [Thinking] {component.reasoning.content}")
    elif component_type == "sources":
        for src in component.sources.sources:
            print(f"  [Source] {src.title}: {src.url}")
    elif component_type == "error":
        print(f"\n[Error] {component.error.title}: {component.error.content}")
    elif component_type is None and chunk.HasField("usage"):
        print(f"\n[Usage] {chunk.usage.total_tokens} tokens ({chunk.usage.model})")

print("\nStream complete.")
```

### Adding a New Component Type

1. **Define the message** in `grpc/proto/chatbot.proto`:
   ```protobuf
   message MyNewComponent {
       string content = 1;
       // ... fields
   }
   ```

2. **Add it to the `Component` oneof**:
   ```protobuf
   message Component {
       string id = 1;
       oneof data {
           // ... existing types ...
           MyNewComponent my_new = 16;  // next available field number
       }
   }
   ```

3. **Regenerate** the Python code:
   ```bash
   python grpc/generate_proto.py
   ```

4. **Handle it in the servicer** -- add a branch in `ChatbotServicer._build_component()` (`src/grpc_server/chatbot_servicer.py`):
   ```python
   elif component_type == "my_new":
       component_kwargs["my_new"] = chatbot_pb2.MyNewComponent(
           content=component_data.get("content", "")
       )
   ```

5. **Emit it from the streaming formatter** -- produce a dict with `"type": "my_new"` in `src/smart_rag/messaging/formatters.py`.

### Server Options

The gRPC server is configured with:

| Option | Value | Purpose |
|---|---|---|
| Max message size | 50 MB | Large document payloads |
| Keepalive ping interval | 10 s | Prevent connection drops |
| Keepalive timeout | 5 s | Detect dead connections |
| Compression | gzip | Reduce bandwidth |
| Worker threads | 10 | Concurrent request handling |

For production, use SSL/TLS:

```python
from src.grpc_server.server import start_grpc_server_with_ssl

await start_grpc_server_with_ssl(
    host="0.0.0.0",
    port=50051,
    private_key_path="/etc/ssl/private/server.key",
    certificate_chain_path="/etc/ssl/certs/server.crt"
)
```

### Troubleshooting

| Problem | Solution |
|---|---|
| gRPC server not starting | Run `python grpc/generate_proto.py` to regenerate stubs |
| Import error on `chatbot_pb2` | Ensure `src/grpc_generated/` exists and contains generated files |
| Port already in use | Change `GRPC_PORT` in `.env` or stop the conflicting process |
| Want REST-only mode | Set `GRPC_ENABLED=false` in `.env` |
| Connection timeout | Check firewall rules allow port 50051; verify keepalive settings |

### Further Documentation

Detailed gRPC guides are available in `grpc/documentation-grpc/`:

| File | Topic |
|---|---|
| `GETTING_STARTED.md` | Full quickstart with architecture overview |
| `COMPONENT_TYPES_GUIDE.md` | All component types in detail |
| `STREAM_CHUNK_TYPES.md` | Stream chunk reference |
| `NEW_STREAM_FORMAT.md` | Component-based stream format |
| `AGENT_REQUEST_FLOW.md` | Manual vs auto agent routing |
| `API_TO_UI_MAPPING.md` | Mapping components to frontend UI |
| `GRPC_SETUP_SUMMARY.md` | gRPC implementation details |
| `WEB_SOURCES_IMPLEMENTATION.md` | Web search source citations |
| `V2_API_GUIDE.md` | V2 schema migration guide |

## Testing

```bash
# Run all tests with coverage
pytest

# Run specific test markers
pytest -m unit
pytest -m integration
```

Test coverage is configured for `src/smart_rag` with an 80% minimum threshold.

