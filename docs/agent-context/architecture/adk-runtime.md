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

## Conversation native Responses boundary (2026-10-16)

### Admission timing and connector schema disclosure (2026-10-17)

Subsequent upstream profiling found 4–8 ms reported LiteLLM overhead in matched
synthetic calls. The installed SDK's SSE completion closes HTTP/1.1 before body EOF,
so even a reused client paid ~183 ms TCP/TLS setup again. Native Responses now uses
loop-owned HTTP/2-capable connections with independent per-turn SDK/HTTP identity,
headers and cookie jars. A borrowed transport preserves owner proxy routing; turn
closure does not close the shared pool. The lifespan drains gRPC before closing it.
SDK connection counts remain unchanged; the shared pool now has a qualified
30-second idle expiry (initially five seconds). Expired/HTTP1 fallback
requests still pay connection setup. A matched pair isolated ~177 ms saved while
provider processing stayed essentially equal. See proposed
[ADR-0022](../decisions/ADR-0022-conversation-responses-http2-pool.md) for lifecycle,
pinned private HTTPX routing dependency, tests and rollback. Chat Completions retains
its existing transport. Neither mode changes reasoning, tools, retries or capacity.

`conversation_latency_diag.provider_http` adds numeric TCP/TLS/header timing,
HTTP/2 negotiation and finite allowlisted gateway timing headers; `provider_usage`
records final primary-call input/cached/reasoning/output token counts in both APIs.
These diagnostics do not serialize HTTP requests or change public latency fields.

Follow-up controlled idle probes reused the gateway connection at six/15/25 seconds
and reconnected at 31 seconds. The five-second control reconnected at six/25 seconds.
The six-second comparison isolated about 190 ms saved with identical reasoning/tools
and essentially equal gateway processing. Only the shared network pool changes;
SDK connection counts and turn identity/cookies remain isolated. A mocked peer-close
test verifies no retry and retained uncertain capacity. HTTP/2 idle peer closure can
still fail a request; the pool does not add speculative retries to conceal it.

First-event profiling adds `conversation_latency_diag.provider_stream` for the
primary Responses stream only. It separates dispatch/upload, upload-to-headers,
headers-to-first-body, first-body-to-native-event delivery, native reasoning/summary/text/tool milestones
and useful-native-to-ADK delivery. The HTTP body observer forwards bytes immediately
and delegates close; it never retains bytes. Event observers retain only fixed
monotonic timestamps, never payloads. Later model calls do not overwrite the first
stream. Public TTFT, terminal validation, retries and capacity remain unchanged.
These client intervals cannot distinguish remote queueing from prefill/generation.
LiteLLM 1.101 computes queue metadata internally but its ordinary duration headers
do not expose queue time. The configured gateway's `/metrics` returned 404 during
qualification; exact queue attribution needs gateway-side queue/TTFT metrics.

The first capacity-gated call now records monotonic acquisition, durable running
transition, dispatch-to-first-SDK-event and dispatch-to-first-ADK-response timings
in `conversation_latency_diag.provider_timing`. The existing public provider TTFT
keeps its original boundary. An early Responses SDK event can be lifecycle metadata,
so dispatch-to-ADK-response is the useful model-output boundary; neither duration
claims pure provider inference. Permit ownership, retries, fencing and uncertain
outcome handling are unchanged. Real gateway tiny-prompt probes measured warm
admission about 153 ms, separately from about 976/1,001 ms upstream-to-ADK response
for Responses/Chat Completions. These are not full conversation timings.

Conversation parents defer connector declarations through the native ADK toolset
interface. A compact complete catalog loads selected original schemas for the next
model step; all original authorized wrappers remain dispatchable. Invocation-local
selection does not enter durable history. Other tools and worker paths are unchanged.
Responses compatibility hashes the complete authorized catalog so disclosure changes
do not discard reasoning or provider chains. Actual capability changes still rebase.
First connector use can add one model round trip. See proposed
[ADR-0021](../decisions/ADR-0021-conversation-deferred-connector-schemas.md) for measured
schema reduction, gateway checks and rollback.

`team_orchestrator.py` adapts the library-built single-agent parent with
`LLMFactory.for_conversation()` with the model's explicit `conversation_api` agent
parameter. Admin > Models persists `conversationApi` in the existing catalog;
`responses` selects the pinned native adapter through the LiteLLM gateway and
`chat_completions` retains the instrumented LiteLLM adapter. Missing values default
to Chat Completions. Model names do not determine the API. Workers and manager/team
paths are unchanged. No service or protobuf field is added; existing parameter maps
carry the setting. Deploy backend migration `0050_model_conversation_api.sql` first.

Models additionally select Responses history (application/provider), reasoning
replay (none/last/all/auto) and summaries (off/auto/concise/detailed), defaulting to
application/auto/off. Application mode retains `store=false`; the adapter preserves
original ordered provider items in private existing ADK session state to restore
reasoning the pinned converter otherwise skips. Last/Auto preserve the current
tool loop; All permits compatible cross-turn reasoning. Provider mode requires
Auto, uses `store=true` and response-ID chaining with delta input. Local history
remains available in both modes. API/model/agent/configuration or transcript changes
reset lineage; an explicit missing-response rejection rebases once. Chat Completions
retains application-managed history and clears stale lineage. Native summaries use
the existing activity panel; encrypted state never enters yielded answer events.
Apply migration `0051_model_responses_history_controls.sql`. See proposed
[ADR-0020](../decisions/ADR-0020-conversation-responses-history-controls.md).
Per-turn SDK clients close in the orchestrator's `finally` path. MCP identity and
tools are unchanged.

Isolated root turns carry compatible private context through the existing
`SeedConversationSession` boundary's optional source session ID. The backend selects
the last completed answer actually included in the seed snapshot. The runtime
loads only the same app/user source and verifies its complete visible transcript
before copying Responses state into the new session. It rebuilds the seed's text
projection while preserving raw ordered provider items and the configuration
signature; edits, truncation or missing source safely rebase. No other source
session state or event is copied.

Conversation setup avoids redundant history materialization (2026-10-17): fresh
bootstrap uses public `GetSessionConfig(num_recent_events=0)` for state/existence;
the ADK Runner still performs its authoritative full read, and resume retains full
events. On pinned ADK this skips one event query without caching session state.
Private seed-source validation reads only same-app/user/session state and ordered
events (two queries instead of four). This storage fast path is limited to the
ordinary `DatabaseSessionService`; custom/fenced services retain their public
ownership checks. Seed insertion updates its newly created target with scoped
app/user/session predicates in the existing transaction instead of selecting it
again. Public session creation, seed idempotency, transcript validation and runtime
append revision/ownership checks remain unchanged.

Local Luna verification on 2026-10-17 preserved multi-turn marker recall and private
Responses continuity. A same-source read benchmark reduced median source loading
from 189.7 to 150.4 ms (four interleaved samples per path). Live warm-turn seeding
fell from 671.7 to 460.1 ms and outer session lookup from 214.6 to 159.8 ms;
cold post-restart seeds stayed 658–668 ms, so these are observations rather than
a guaranteed end-to-end improvement. The warm turn still spent 605 ms inside
ADK runtime before the model, 929 ms resolving workspace/agents, and 4.88 s waiting
for the provider's first token. Full Runner history reads and durable event appends
remain necessary; their individual live costs were not captured by the local log sink.

Further controlled real-database profiling (2026-10-17), using a synthetic session
with all 16 Luna source events and a stub model, attributed warm pre-model time
to the authoritative lookup (183.8 ms median) and durable append (197.6 ms).
The existing instrumented session service now joins session/app/user state in one
scoped LEFT JOIN instead of three sequential reads, followed by the complete
timestamp/ID-ordered event query. SDK state merge and storage conversion preserve
the revision marker; metadata-only reads use one query. Exact ADK 2.11.0 and class
guards retain the public SDK lookup for upgrades and custom/fenced services.
No cache, isolation change or write bypass is used. The same real-database Runner
probe measured pre-model median 378.3 to 347.3 ms and lookup 183.8 to 150.7 ms;
durable append stayed approximately 194–198 ms. Tests retain stale-write rejection
and atomic state/event rollback. See the upgrade runbook before changing the guard.
Live Luna marker recall passed after restart and on the next warm turn. The warm
turn measured 555 ms runtime pre-model versus 599–605 ms before, with outer session
lookup 134 ms and setup 135 ms. The first cold turn measured 727 ms runtime, so
the improvement is modest and does not remove restart/network variability.

Durable-append profiling on the same local database (2026-10-17) measured about
193 ms total: connection pre-ping ~55 ms, required session/app/user reads ~74 ms,
UPDATE/INSERT ~39 ms and actual COMMIT ~19 ms (small Python overhead and network
variation account for the remainder). Asyncpg pre-ping uses three round trips to
remain compatible with transaction-mode poolers; it stays enabled. For exact
ADK 2.11.0 ordinary PostgreSQL sessions with a storage revision marker and only
session/temporary deltas, the existing service joins required row reads under
`FOR UPDATE OF` the session row. It still rejects missing app/user/session rows,
holds the session lock, checks the exact revision and commits state plus event
atomically before updating the in-memory event list. Global deltas and all other
guarded cases use SDK append. Real PostgreSQL median append fell from 190.8 to
157.6 ms (five SQL statements to three); actual commit and connection validation
remain unchanged. Five races using independent services each produced exactly
one durable event and one stale rejection; injected insert and post-flush commit
failures rolled back state, events and revision. Requalification is in the upgrade runbook.
A full Runner probe with a synthetic model and complete copied history measured
warm pre-model median 300.0 ms (lookup 140.6 ms, append 156.6 ms), compared with
347.3 ms before this write optimization; cold imports are excluded from that comparison.

Latency/recovery and durable provider-slot ownership remain enforced. Native SDK
calls use `CapacityClient.create()` with retries disabled when capacity is enabled.
Stream validation requires a terminal Responses event before EOF. Truncated text
or tool arguments fail and uncertain dispatched calls retain their slot.

Sources: `src/smart_rag/infrastructure/factories/llm_factory.py`,
`src/smart_rag/infrastructure/monitoring/{instrumented_lite_llm,model_response_recovery}.py`,
`src/root_runtime/model_capacity.py`. Checks: `tests/test_native_responses.py`, existing
latency/factory/orchestrator tests, opt-in `tests/wp10/qualify_native_responses.py`.
Live synthetic gateway qualification passed with `gpt-5.4-mini` and capacity enabled;
browser/end-user QA is separate. See proposed [ADR-0019](../decisions/ADR-0019-conversation-native-responses.md).

## Conversation image inputs for Code Interpreter (2026-10-15)

The existing `generate_image` utility calls the authenticated backend image boundary and
records validated `sandboxPath` receipts in private, invocation-scoped ADK state.
Conversation connector tools merge those exact inputs into the existing `x-file-paths`
mount contract using trusted user/conversation identity; this includes files staged after
the original attachment manifest was built. Original file inputs and authentication are preserved.
At `sandbox_create`, the existing `SandboxMountGuard` probes only these exact paths,
permits one destroy/recreate if inputs are missing, and blocks dependent execution until
validation succeeds. Prepare every image before creation; changed inputs afterward fail closed.
This reuses the existing user-scoped sandbox lease and does not guarantee isolation between
concurrent conversations. Source: `src/smart_rag/tools/utilities/generate_image.py`,
`connector_tools.py`, `src/flow_engine/tools/sandbox_mount_guard.py`; focused coverage:
`tests/test_tools/test_generate_image.py` and `tests/test_tools/test_utilities/test_connector_tools.py`.

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

### Shared MCP transport and identity (2026-10-16)

`yellowstorm-adk/src/mcp/{__init__,jwt_auth}.py` owns the shared client used by
conversation connector tools and Playbook tool factories. It replaces the misleading
`src/flow_engine/mcp` location; there is one implementation. Import it as `src.mcp`,
keeping project root on `PYTHONPATH` so the installed `mcp` SDK is not shadowed.
Each tool call creates/initializes a client session; this is separate from persistent
application conversation history. Semantic Model MCP explicitly executes statelessly
with per-request verified identity and cleanup.

Internal JWT bindings originate in current backend connector policy. Renewal uses
the deployment-only `ADK_RUNTIME_MCP_RENEWAL_TOKEN` and an existing valid signed
assertion bound to connector/revision, never an editable user ID. Expired proof needs
authenticated rebinding. Other connectors keep their selected authentication profile;
JWT is not universal. Destination and no-redirect enforcement must precede credential
attachment for each supported transport. See
[ADR-0018](../decisions/ADR-0018-connector-managed-mcp-security.md) for configuration,
ownership, rollout and the verification gate; no server is certified as a reference.

### Private native execution authority (P1)

Native workspace/asset/image/Telegram calls use dedicated Root/conversation or
Playbook machine credentials plus live signed execution proof, independently of
MCP authentication. The backend derives the actor and rechecks canonical leases,
current rights and target scope. A native-conversation proof cannot control Root
executions. Root child validation distinguishes the current/frozen parent root
definition from the selected worker definition; native worker sources can be
outside conversation links, while root-constrained mode retains its frozen ceiling.

Proofs travel in private gRPC metadata and context-local runtime state; provider
headers and MCP assertions cannot substitute. Foreground child native authority
is bound to the canonical child and parent's live stream lease without replacing
parent-control authority. Admission proof is received only in the internal
`X-YellowStorm-Child-Authority` response header, then installed in a separate
task-local native context with renewal/cleanup and no parent fallback. Temporary
sources are restricted to their admitted IDs intersected with the frozen parent
ceiling. Required scoped review passed after these role-aware source corrections.
Background task renewal is independent of an observing RPC, and context/renewal
cleanup follows execution ownership. See [cross-service contracts](cross-service-contracts.md#grpc-nestjs--adk)
and the [source/evidence inventory](../../security/internal-principal-inventory.md).
Local HTTP/gRPC tests and build checks do not establish full application startup,
live provider/storage or deployment qualification.

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
