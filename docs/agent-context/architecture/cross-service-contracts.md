# Cross-service contracts and flows

Inspection date: 2026-10-13. Both sides checked where stated; executable
schemas/protos/tests linked instead of copied. Implemented additions identify
their owning source and verification below.

## REST (browser ↔ NestJS ↔ MCP)

- Browser→NestJS: versioned prefix resolved by `resolveApiPrefix` /
  `API_DEFAULT_VERSION` (`YellowStorm/back/src/main.ts`, `src/modules/auth/auth-cookie-path.ts`);
  global `ValidationPipe` (strict/transforming, `main.ts:141-152`); shared
  pagination DTO `src/common/dto/pagination.dto.ts`. Frontend uses shared
  `apiClient` + `API_ENDPOINTS` (`YellowStorm/front/src/lib/api/config.ts`,
  `src/lib/api/client.ts:11-145`) and per-module `api.ts` with `useApiAction`.
  Auth: in-memory access token + HttpOnly refresh cookie (`withCredentials`),
  queued/burst-limited refresh with cross-tab coordination.
- Error parity: backend domain exceptions carry registered codes; frontend keeps
  enum parity + EN/FR messages (`YellowStorm/front/src/lib/error-codes.ts`).
  Adding a code requires both sides + localized message.
- MCP→NestJS: Agent, Playbook and Semantic clients send their distinct machine
  principal/token plus `X-YellowStorm-Mcp-Assertion`. Controller-owned audiences
  fence each domain; the verified signed subject owns attribution and a supplied
  user header may not disagree. Generic `X-Internal-Token` authorization and the
  Semantic client's redundant generic-key dependency are removed. Internal JWT
  assertions are RS256, bounded to 300 seconds; current account, connector policy,
  revision and resource rights are rechecked. Other MCP profiles remain valid.
  See the [principal matrix](../../security/internal-principal-inventory.md).
  Health remains `GET /health/live`, `/health/ready`.

### Semantic-model My jobs (browser ↔ NestJS ↔ semantic runtime)

- The semantic-model catalog, editor and run panel expose **My jobs**. The list
  contains only jobs submitted by the authenticated user, across models the user
  currently owns or belongs to. Active and History views are paginated; the model
  filter is optional. Cancelled jobs remain in History, including queued jobs
  cancelled before starting.
- NestJS routes under the configured API prefix:
  - `GET /semantic-models/population/jobs`: validated `modelId?`, `view`
    (`active` by default), `page` (1 by default) and `limit` (20 by default, at
    most 100). The response contains `items`, `pagination`, `activeCount`,
    `queuedCount` and accessible model options. Items include model names,
    concept labels and whether the current model role permits management.
  - `POST /semantic-models/population/jobs/:jobId/stop`: body `onlyQueued`
    defaults to false. The current user must own the job and have an editor or
    owner role on its model, as well as the endpoint's update permission.
  - `POST /semantic-models/population/jobs/queued/remove`: optional body
    `modelId` filters bulk removal. Without it, only the user's queued jobs in
    currently editable accessible models are cancelled. The response counts
    cancelled and skipped jobs. Running jobs are preserved.
- The browser never supplies actor identity or a model allow-list. NestJS derives
  both and sends `X-Actor-User-Id` plus the existing service credential to the
  runtime. Runtime `POST /v1/semantic-model-jobs/read` requires an explicit
  `modelIds` list; empty means none. Runtime `POST .../cancel-queued` uses the
  same scope. Existing `POST .../:jobId/cancel` accepts `onlyQueued=true` for
  race-safe single queued removal. Job commands are not exposed: only their
  sanitized target scope and purpose are added to job metadata.
- Queue-only cancellation locks actor-scoped tasks before the job, matching
  claim ordering. A task already locked by a claimant is skipped. Eligibility
  is checked before graph-search lease side effects. A job that starts while
  removal is pending is left unchanged. Normal running-stop semantics and the
  non-cancellable saving boundary remain intact.
- Owners: backend `semantic-model.controller.ts`, DTOs,
  `semantic-population-refresh.service.ts`, `semantic-model.repository.ts` and
  `semantic-runtime-client.service.ts` under
  `YellowStorm/back/src/modules/semantic-model/`; runtime `app/api/job_routes.py`
  and `app/persistence/postgres_jobs.py`; frontend module `api.ts`, `types.ts`
  and `components/population/MyJobsDrawer.tsx`.
- Verification: backend population-refresh service tests; frontend My jobs,
  population-status and queued-notice tests; runtime `tests/test_my_jobs.py` and
  `tests/test_my_jobs_live.py`. The live tests admit jobs with unique test
  actor/model/queue identifiers into existing schemas, exercise real concurrent
  claim/cancellation, and clean up only their own rows. They never reset shared
  schemas or cancel existing user jobs. Browser verification is a separate gate.

### Semantic AI extraction (semantic runtime ↔ LiteLLM)

The semantic runtime API and population workers call LiteLLM directly, with
runtime-owned prompts/configuration. NestJS no longer proxies inference to ADK
or resolves a semantic extraction agent from the agent library. Product
authorization/job coordination and backend workspace asset delivery remain.

The existing population API exposes protected profile discovery and standalone
supplied-evidence extraction under `/v1/semantic-model-population/ai-extraction`.
Both use `X-Semantic-Service-Key` and the existing command body limit. The
non-secret profile is obtained by the backend before fingerprinting AI requests;
runtime admission validates/pins identity and workers recheck it before cache or
source access. Model/prompt/token-cap changes invalidate AI identities; old
agent-library identities fail with rebuild-required errors.

Executable owners: runtime `app/api/population_routes.py`,
`app/datasource/attribute_extraction.py`, `app/workers/population_tasks.py`, and
backend `semantic-runtime-client.service.ts`. Request shapes, configuration,
coordinated rollout and compatibility are documented in the
[runtime contracts guide](../../../YellowStorm/semantic-model-runtime/contracts/v1/README.md)
and [ADR-0015](../decisions/ADR-0015-runtime-owned-semantic-ai-extraction.md).
Focused API/transport/grounding/worker/fingerprint checks passed; required review
found no critical/major issues. Live provider/deployment verification is separate.

## gRPC (NestJS ↔ ADK)

P1 native-tool authority is separate from the channel API key and MCP assertions.
Backend dispatch carries private `x-yellowstorm-root-authority`,
`x-yellowstorm-native-authority` or `x-yellowstorm-artifact-authority` metadata,
bound to canonical actor/execution/message/job and the live dispatch generation.
ADK keeps it request/task-local and forwards `X-YellowStorm-Execution-Authority`
with the matching dedicated machine principal on native backend calls. Never put
these proofs in protobuf Struct/model parameters, definitions, public events or
logs. Root controls and delegated-child native authority must remain separate;
foreground children need their own canonical proof anchored to the parent's live
stream lease, not a copied parent token. Background renewal follows the owned
task rather than an RPC observer. This boundary is under required review; see the
[ADK runtime record](adk-runtime.md#private-native-execution-authority-p1).

Conversation `AgentActivityComponent` optionally carries `activity_kind` (field 9).
Only explicit native Responses summary output/events produce `reasoning_summary`;
raw reasoning and legacy agent activity omit it. Both proto mirrors and generated
Python descriptor agree. The gRPC producer/backend mapper allowlist this value
and expose browser `activityKind`; unknown/absent values retain generic activity.
This display provenance contains no encrypted replay state and needs no migration.

Conversation Responses continuity (2026-10-17): the mirrored `chatbot.proto`
`SeedConversationSessionRequest.source_session_id` is optional. Backend derives
it from the completed history snapshot; Python reads only the same app/user
session and copies only transcript-verified private Responses state. Missing
sources retain normal local-history seeding. The typed `RootExecutionContext`
adds `visible_user_message` for the original text before backend page hints; it is an exact
private receipt for comparison, never a parsed authorization source. See proposed
[ADR-0020](../decisions/ADR-0020-conversation-responses-history-controls.md).

Proto pairs (both copies authoritative; drift-tested where noted):

| Domain | Backend copy | ADK copy | Notes |
|---|---|---|---|
| Chat | `YellowStorm/back/src/modules/conversation/proto/chatbot.proto` | `yellowstorm-adk/grpc/proto/chatbot.proto` | `RunAgentTeam` streaming + `RunSingleAgent`; `GenerateConversationName` unary |
| Conversation-v2 | `…/conversation-v2/proto/conversation.proto` | (served via chatbot/playbook surfaces; see ADK routers) | Confirm pair before editing |
| Playbook | `…/playbook-flow/proto/playbook-flow.proto` | `yellowstorm-adk/grpc/proto/playbook-flow.proto` | Exact-text drift test `yellowstorm-adk/tests/flow_engine/test_proto_drift.py:16-25` |
| Agent admin | `…/agent/proto/a2a_admin.proto` | `yellowstorm-adk/grpc/proto/a2a_admin.proto` | Mirror check before change |
| Companion | `…/worky/proto/companion_ai.proto` | `yellowstorm-adk/grpc/proto/companion_ai/companion_ai.proto` | Plus `ELECTRIC_SETUP.md`, `generate.py`, `README.md` |

Rules: wrap every protobuf `Struct` value with `toGrpcStruct()` at the call site
(`YellowStorm/back/src/modules/playbook-flow/execution/grpc/grpc-struct.mapper.ts:24-44`;
re-exported by `playbook-flow-execution.service.ts:74-76`; used at
`conversation-agent-request.builder.ts:113`, `playbook-flow-execution.service.ts:1283-1341`,
`playbook-execution-hitl-resume.service.ts:128,297`). Auth: `x-api-key` metadata
+ TLS in prod (`GRPC_API_KEY`, `GRPC_TLS_*` required; `GRPC_ALLOW_INSECURE=false`);
backend channel helper `src/common/grpc/grpc-security.util.ts`. Copy protos to the
runtime bundle via `postbuild` (`scripts/copy-runtime-protos.cjs`).
Frontend never calls ADK directly — all ADK traffic is backend-mediated.

## Streams and sockets

- Conversation SSE: legacy `EventSource` owner
  (`YellowStorm/front/src/modules/conversation/stream.ts:47,91,343`); API client
  coordinates legacy + v2 stream services (`src/lib/api/client.ts:13-14`).
  Streams clean up on disconnect, keep ordered cursors, stay unbuffered.
- Browser-session: Socket.IO namespace `/browser-session`
  (`browser-session/browser-session.gateway.ts:17`); 1280x720 viewport contract on
  both sides; acks + safety controls are cross-boundary.
- App-runtime: one-shot tickets, registration, heartbeat, revision rehydration;
  generated widget runtime stays vanilla JS
  (`src/modules/agent/constants/widget-template.ts:548`).
- Conversation-v2 single app-shell connection is stated policy; owner not fully
  traced — see [baseline gaps](baseline-gaps.md).
- Backend detail: [realtime](../backend/realtime.md); frontend detail:
  [realtime](../frontend/realtime.md).

## Widget and embed contract

- Routes guarded by `WidgetTokenGuard`
  (`widget-chat/guards/widget-token.guard.ts:20-27`,
  `controllers/widget-chat.controller.ts:33-236`,
  `controllers/agent-integration.controller.ts:33`); origin allowlist enforced on
  `Origin`/`Referer`; never retain plaintext tokens after creation.
- Flow: snippet (`createWidgetToken` → `buildWidgetSnippet` with `VITE_API_URL`)
  → session → `executeStream → gRPC RunAgentTeam → SSE`
  (`src/modules/widget-chat/README.md:32-70,181-301`).

## Persistence-adjacent contracts

- Conversation persistence is PostgreSQL (Drizzle `0005-0015_*` + later governance/
  workspace/app-data migrations `0016-0025_*` in `YellowStorm/back/drizzle/`);
  store tokens keep services storage-agnostic; integration tests use
  `describeIntegration`/`makeTestDb` with `POSTGRES_TEST_DB` (never `agentstore`).
- Workspace documents stay in Mongo + blob storage; citation identity (Postgres)
  → document fetch (Mongo) resolution can disagree on `fileName` vs
  `originalName` — verify both sides on change.
- Idempotency: jobs/event handlers idempotent; concurrent mutations use
  `expectedRevision`; leased workers heartbeat and check lease before publishing.

## Observability contract

- Normative: `contracts/observability/` (`log-events.v1.json`, schemas, budgets,
  severity, redaction, service registry, fixtures); developer rules
  `docs/observability/logging-contract.md`; TS/Python SDKs
  (`packages/observability-ts`, `packages/observability-python`) validated against
  shared fixtures. Backend dependency
  `@yellowmind/observability` (`YellowStorm/back/package.json:60`).
- Gates: `node scripts/observability/check-policy.mjs` (runtime logging changes);
  `node scripts/observability/run-gates.mjs --suite unit` (SDK/contract changes).

## Verification checklist for boundary changes

1. Read both sender and receiver (this doc links both copies).
2. Confirm names, casing, serialization, required/optional/default/absence semantics.
3. For proto changes: update both copies, regenerate (`grpc/generate_proto.py`),
   keep the drift test green, verify `postbuild` bundle.
4. For REST/error changes: update DTO + frontend enum + EN/FR locales + tests.
5. Run the owning suite on each side (`YellowStorm/back`: `npm test -- <pattern>` /
  `test:contracts`; `yellowstorm-adk`: `conda run -n meta pytest <path> -q`;
  `YellowStorm/front`: `npm test -- <pattern>`, `npx tsc --noEmit -p .`).
