# ADK architecture and ownership

Inspection date: 2026-10-13. Source-verified; descriptive prose in
`yellowstorm-adk/README.md` was checked against code and protos — protos and call
sites win on conflict. Semantic extraction ownership updated 2026-10-15 against
`e9ef1676c` plus the scoped migration diff; other sections retain their baseline evidence.

## Ownership and entry points

- Entry: `yellowstorm-adk/main.py:1-54` starts FastAPI routes and the gRPC server
  side by side. gRPC runs in `src/grpc_server/server.py:29-39`; set
  `GRPC_ENABLED=false` for REST-only mode.
- Orchestration: manager agent dynamically delegates to sub-agents (search,
  operator, report writer, HTML diagram, …) via Google ADK `Runner`/`Agent`
  primitives; sequential and parallel workflows supported
  (`src/smart_rag/agents/factories/base_factory.py:387-414,1013`,
  `yellowstorm-adk/README.md:21-35`).
- Agent definitions are factory-built, not a static list; `AgentFactory` guards
  construction, `ManagerAgentFactory` builds the manager.
- Routers (`src/routers/`): `chatbot.py` (chat + agentic), `similarity_search.py`,
  `playbook.py`, `evaluation.py`, `evaluation_batch.py`,
  `vectorstores.py`, `response_correction.py`, `response_evaluation.py`,
  `sse_stream.py`, `authentification.py`, `health.py`.

## REST/SSE surface (FastAPI `:8001`)

Authoritative list: `yellowstorm-adk/README.md:103-136` + `src/routers/*.py`:

- `/chatbots/chatWithADK`, `/chatbots/chat_completion`
- `/agentic/run_agent_team`, `/run_single_agent`, `/config_agents_with_skills`,
  `/clear_agent_memory`, `/attribute_extraction`, `/batch_attribute_extraction`,
  `/batch_status/{batch_job_id}`
- `/similarity-search/similarity-search-with-score`
- `/playbook/execute_playbook_step`, `/execute_playbook`

Streaming is SSE; batch extraction continues via Celery (`attribute_extraction`
queue, Redis broker; `celery -A src.infrastructure.celery_app.celery_app worker …`).

Semantic-model extraction is owned by the standalone semantic runtime, which
calls LiteLLM directly. ADK's former `src/semantic_model` package, dedicated
router and semantic extraction settings are removed. The generic agentic document
extraction endpoints above are separate features. See
[ADR-0015](../decisions/ADR-0015-runtime-owned-semantic-ai-extraction.md) and the
[runtime guide](../../../YellowStorm/semantic-model-runtime/README.md).

## gRPC surface (`:50051`)

Proto sources (authoritative): `yellowstorm-adk/grpc/proto/`:

- `chatbot.proto` — `ChatbotService.RunAgentTeam` (server-streaming),
  `GenerateConversationName` (unary); `StreamChunk{action, component(oneof), metadata, usage}`;
  request must include a manager agent (`agent_type="manager"`).
- `playbook-flow.proto` — `PlaybookFlowRuntime` (`Run`, `RunFromCheckpoint`
  streaming); backend mirrors this file and asserts exact text equality in
  `yellowstorm-adk/tests/flow_engine/test_proto_drift.py:16-25`.
- `a2a_admin.proto`, `companion_ai/companion_ai.proto` — admin/companion RPCs.

Server options: 50 MB max message, 10 s keepalive ping / 5 s timeout, gzip,
10 worker threads (`README` server-options table). Regeneration:
`python grpc/generate_proto.py` → `src/grpc_generated/chatbot_pb2*.py`.
Production uses TLS + `x-api-key` metadata (`GRPC_API_KEY` required,
`GRPC_TLS_CERT_PATH`/`GRPC_TLS_KEY_PATH` required, `GRPC_ALLOW_INSECURE=false`
default); backend channel/auth utilities in
`YellowStorm/back/src/common/grpc/grpc-security.util.ts`.

## Callers (backend-mediated)

No direct frontend→ADK transport was found; frontend reaches ADK through NestJS:

- Chat: `conversation/services/stream.service.ts:1934`
  (`RunAgentTeam` vs `RunSingleAgent` branch) with request builder
  `conversation-agent-request.builder.ts:73-142` and `toGrpcStruct` wrapping.
- Playbook: `playbook-flow/execution/grpc/playbook-flow-runtime-client.service.ts:24-80`
  (`PlaybookFlowRuntime`, metadata, `Run`/`Resume`/`Cancel`) via
  `playbook-flow-execution.service.ts:1283-1341,2020-2041`.
- Struct serialization: `playbook-flow/execution/grpc/grpc-struct.mapper.ts:24-44`
  (`toGrpcStruct` at every protobuf `Struct` call site).
- Widget: `widget-chat` README flow `executeStream → gRPC RunAgentTeam → SSE`
  (`src/modules/widget-chat/README.md:70,236-301`).

## State, memory, and tools

- Sessions: PostgreSQL-backed via ADK `DatabaseSessionService`
  (`DATABASE_URL`, `LANGGRAPH_CHECKPOINT_*` settings).
- Memory: mem0 over Azure AI Search; RAG via hybrid vector+keyword search
  (`src/similarity_search/`, `src/smart_rag/engines/`).
- Tools: search (document/web via Linkup), calculator, Snowflake SQL, DataViz,
  FormViz, Excel (MCP), HTML diagrams (`src/smart_rag/tools/`).
- Streaming format: `formatters.py` emits `{"type": …}` dicts; servicer
  `_build_component()` maps them into `Component` oneof
  (`src/grpc_server/chatbot_servicer.py`).

## Configuration and packaging

- Settings: `src/config/settings.py` (pydantic-settings); env groups documented in
  `yellowstorm-adk/README.md:177-189` (app, LiteLLM, Azure storage/Data Lake,
  Postgres, Redis, search, auth, gRPC + secure-by-default gRPC security).
- Packaging: multi-stage hardened `yellowstorm-adk/Dockerfile:1-20`; compose maps
  REST `3017→8001`, gRPC `50051→50051` (`docker-compose.yaml`).
- Tests: `pytest` (`pytest.ini`), coverage gate on `src/smart_rag` (80% min);
  run via `conda run -n meta pytest <path> -q`. Proto-drift gate above must stay
  green when either proto copy changes.

## Limits / unknowns

- README's RPC prose may lag new RPCs — proto files are the contract.
- Full per-RPC production caller inventory and prod topology were not established;
  see [baseline gaps](baseline-gaps.md).
- gRPC docs: `yellowstorm-adk/grpc/documentation-grpc/` (getting started,
  component/stream guides, V2 migration).
