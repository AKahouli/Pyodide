# Component responsibilities and data ownership

Inspection date: 2026-10-16. Verified against source listings; one-line roles are
summaries — owning module READMEs, source, schemas, and tests are authoritative.
No behavior was changed by this baseline.

## Backend (`YellowStorm/back/src/modules/*`)

NestJS feature ownership: controllers wire DTOs to services; owning modules register
schemas and export only needed services. Global `JwtAuthGuard` + `AccountApprovalGuard`
(`src/app.module.ts:155-165`); public routes need explicit `@Public()`.

52 module directories observed (listing, not an inventory of internals):

`agent`, `agent-type`, `ai-proxy`, `analytics`, `app-builder-ai`, `app-data`,
`app-runtime`, `auth`, `authorization`, `auth-provider`, `browser-session`,
`channels-teardown`, `chat-completion`, `classifier`, `connected-app`, `connector`,
`conversation`, `conversation-v2`, `document`, `email`, `evaluation`, `exceptions`,
`governance`, `guardrails`, `health`, `humain-agent`, `indexing`,
`integration-events`, `knowledge-intelligence`, `logger`, `memory-cards`, `models`,
`notifications`, `playbook-flow`, `postgres`, `project`, `rate-limiter`,
`request-context`, `response`, `semantic-model`, `skill`, `system`, `team`,
`telegram`, `tool`, `usage`, `user`, `user-group`, `widget-chat`, `workspace`,
`workspace-artifact`, `worky`.

Key ownership (verified call sites/READMEs, details in linked refs):

| Module | Owns | Data / contract notes |
|---|---|---|
| `conversation` / `conversation-v2` | Chat orchestration, SSE streams, agent-request building | PostgreSQL stores via tokens; gRPC `RunAgentTeam`/`RunSingleAgent` (`services/stream.service.ts:1934`, `services/conversation-agent-request.builder.ts:73-142`); module README at `src/modules/conversation/README.md` |
| `playbook-flow` | Playbook construction/execution, HITL resume, advisor | `PlaybookFlowRuntime` gRPC client (`execution/grpc/playbook-flow-runtime-client.service.ts`); `toGrpcStruct` mapper (`execution/grpc/grpc-struct.mapper.ts`); proto `playbook-flow/proto/playbook-flow.proto` |
| `widget-chat` | Public embed chat + agent integration | All routes `@UseGuards(WidgetTokenGuard)`; origin allowlist; `RunAgentTeam` manual mode (`src/modules/widget-chat/README.md:32-70,181-301`) |
| `auth` / `auth-provider` / `authorization` | Sessions/JWT, OAuth, RBAC | `@Public()` opt-out; login lockout + rate limiter (`auth/throttle/*`); see [security](../backend/security.md) |
| `postgres` | Pool (`PG_POOL`), Drizzle handle, schema, test helpers | `src/modules/postgres/`; schema `src/modules/postgres/schema/`; integration helper `testing/pg-integration.ts`; see [persistence](../backend/persistence.md) |
| `browser-session` / `app-runtime` | Socket.IO `/browser-session`, app-runtime tickets/heartbeat | Gateway `browser-session/browser-session.gateway.ts:17`; see [realtime](../backend/realtime.md) |
| `workspace` / `workspace-artifact` / `app-data` | Documents, artifacts (revision concurrency), app data | Revision `expectedRevision` + compound indexes; Mongo-embedded leases for jobs; see [persistence](../backend/persistence.md), [domains](../backend/domains.md) |
| `worky` / `agent` / `chat-completion` / `models` | Companion AI, agent registry, completions, model catalog | Protos `worky/proto/companion_ai.proto`, `agent/proto/a2a_admin.proto`, `conversation/proto/chatbot.proto`, `conversation-v2/proto/conversation.proto` |
| `usage` / `analytics` / `evaluation` / `guardrails` | Metering, analytics, evals, safety | Event/observability boundaries; see [operations](../backend/operations.md) |
| `connected-app` / `connector` / `telegram` / `email` | External integrations | Per-module auth/secrets; no plaintext token retention |

Structural detail: [foundation](../backend/foundation.md),
[configuration](../backend/configuration.md), [API contracts](../backend/api-contracts.md),
[operations](../backend/operations.md), [domains](../backend/domains.md).

## Frontend (`YellowStorm/front/src/modules/*`)

Hash router (`src/Router.tsx`) with lazy routes and `RootGuard`/`AdminGuard`/
`PermissionGuard`. Shared `apiClient` + `API_ENDPOINTS` + per-module `api.ts`;
`useApiAction` in components. Access token in memory, refresh-cookie +
subscriber queue. One global Sonner Toaster.

26 module directories observed:

`admin`, `agent`, `app-builder`, `auth`, `connected-app`, `connector`,
`conversation` (legacy SSE `stream.ts`), `conversation-v2` (Studio/runtime),
`file-viewer`, `governance`, `groups`, `localization`, `models`, `notifications`,
`platform-copilot`, `platform-overview`, `playbook`, `profile`, `project`,
`semantic-model`, `sidebar`, `skill`, `team`, `usage`, `workspace`, `worky`.

Module READMEs beside the module are authoritative (e.g.
`src/modules/conversation-v2/README.md`, `src/modules/workspace/README.md`,
`src/modules/agent/README.md`, `src/modules/conversation/README.md`).
State: per-module Zustand `store.ts` (models, agent, workspace, worky), React Query
(governance/worky + Playbook provider); XState presence not established — see
[baseline gaps](baseline-gaps.md). Env: runtime `/config.js` → build-time
`VITE_API_URL` → dev default; socket base `VITE_SOCKET_BASE_URL`; flags
`VITE_OPENUI_RENDER_ENABLED`, `VITE_CONVERSATION_LATENCY_UI_ENABLED`,
`VITE_APP_RUNTIME_ENABLED`, playbook query flags, `VITE_WORKY_MCP_URL`,
`VITE_APP_URL` (`src/lib/api/config.ts:27-109`, `src/vite-env.d.ts:6-11`).

Detail: [frontend architecture](../frontend/architecture.md),
[state and data](../frontend/state-and-data.md), [API and errors](../frontend/api-and-errors.md),
[realtime](../frontend/realtime.md).

## ADK (`yellowstorm-adk/**`)

Manager/subagent orchestration on Google ADK (`AgentFactory`, `ManagerAgentFactory`
in `src/smart_rag/agents/factories/base_factory.py:387-414,1013`). Routers:
`chatbot`, `agentic` (team/single/attribute extraction), `similarity_search`,
`playbook`, `evaluation`, `semantic_model`, `vectorstores`, `sse_stream`, `health`.
Protos owned: `grpc/proto/chatbot.proto`, `a2a_admin.proto`, `playbook-flow.proto`,
`companion_ai/companion_ai.proto`. Packaging: multi-stage Dockerfile, Celery worker
(`attribute_extraction` queue). Full detail: [ADK runtime](adk-runtime.md).

## MCP (`mcp/*`)

| Server | Role |
|---|---|
| `mcp-playbook` | FastMCP Streamable HTTP adapter (`:8025`); calls NestJS Playbook-assistant REST (`server.py:55-57,187-221`); NestJS authoritative for access/validation/execution; Bearer or JWT ingress; Yellowmind allowlist enforced |
| `mcp-agent` | Agent vertical adapter (see `mcp/mcp-agent/README.md`) |
| `mcp-semantic-model` | Semantic-model adapter (see module/README) |
| `mcp-platform` | **Consolidation target (ADR-0035, proposed/in progress)**: one modular FastMCP deployment (`:8030`, stateless Streamable HTTP) mounting Playbook, Agent/Team and Semantic tool modules over a shared JWT-only foundation (single `mcp-platform` audience, ADR-0033); replaces the three rows above after migration verifies |
| `mcp-outlook` | Microsoft Graph Outlook/calendar connector; JWT ingress (`Authorization`) plus the acting user's delegated Graph token in `X-M365-Access-Token`, stateless streamable HTTP, refusing tool calls when that delegated credential is absent, duplicated or equal to the assertion (ADR-0026) |
| `mcp-team` | Microsoft Graph Teams connector; JWT ingress (`Authorization`) plus the acting user's delegated Graph token in `X-M365-Access-Token`, stateless streamable HTTP, refusing tool calls when that delegated credential is absent, duplicated or equal to the assertion (ADR-0026); original source repository is `YellowsysOrg/mcp-teams` because the requested `mcp-team` URL is unavailable |
| `mcp-sharepoint` | Microsoft Graph SharePoint/OneDrive connector with bounded Ceph run storage; JWT ingress (`Authorization`) plus the acting user's delegated Graph token in `X-M365-Access-Token`, refusing tool calls when that delegated credential is absent, duplicated or equal to the assertion (ADR-0026) |
| `mcp-manus` | Firecracker sandbox connector; uses the upstream `sandbox_mcp` runtime and required internal API-key ingress |

## Supporting services

- `yellowstorm-code-runtime/`: Node ESM sandbox executor (`package.json` scripts
  `test`/`build`/`typecheck`; `tests/http-api.test.ts`, `tests/quickjs-executor.test.ts`).
- `contracts/observability/`: normative `log-events.v1.json`, schemas, budgets,
  severity, redaction, service registry; developer contract
  `docs/observability/logging-contract.md`.
- `infra/observability/`: Alloy → Loki → Grafana (+ Prometheus metrics, nginx
  gateway); local compose in `infra/observability/compose.yaml`.
- `packages/observability-ts`, `packages/observability-python`: shared SDKs
  validated against the same fixtures.
