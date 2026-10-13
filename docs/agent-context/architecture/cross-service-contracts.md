# Cross-service contracts and flows

Inspection date: 2026-10-13. Both sides checked where stated; executable
schemas/protos/tests linked instead of copied. No behavior changed.

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
- MCP→NestJS: Playbook MCP calls internal Playbook-assistant REST via
  `clients/yellowstorm_playbook_client.py:28-52`; sends `X-Internal-Token`
  (`YELLOWSTORM_INTERNAL_SERVICE_TOKEN`) plus user envelope
  (`X-YellowStorm-User-Id`, optional tenant/agent/conversation/correlation).
  JWT mode: 5-min RS256, `sub` is the actor, headers cannot override
  (`mcp/mcp-playbook/README.md:7-19`). Health: `GET /health/live`, `/health/ready`.

## gRPC (NestJS ↔ ADK)

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
