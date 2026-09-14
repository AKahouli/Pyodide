# mcp-agent MCP server + agent-library-driven team generation

## Root cause of the error
`TeamService.generateTeam` (team.service.ts:319) does a **direct LiteLLM chat-completion call** (`ChatCompletionService`), which the proxy rejected (`ERR_2902` → wrapped as `ERR_3312`). This also violates the workspace rule that AI logic must run in a dedicated YellowStorm ADK agent. We fix it by moving generation onto a dedicated library agent whose tools come from a new **`mcp-agent`** MCP server (streamable HTTP), mirroring the proven `mcp-playbook` ↔ `platform_copilot` pattern.

Decisions (confirmed): **full rework**; auto-builder is **agent-library driven** (seeded agent owns instruction/model/temperature; admin config shrinks to an enable toggle).

## Target flow
POST /api/v1/teams/generate → `generateTeam` → `AgentTaskExecutionService.runSingleAgentTask()` (gRPC `RunSingleAgent`) with the seeded **team auto-builder** default agent → ADK builds its connector tools from the `agent-mcp` connector (streamable_http, port 8026) → LLM calls tools (`list_agent_types`, `create_agent`, `create_team`, `update_team_hierarchy`…) → mcp-agent server calls back NestJS internal REST (`X-Internal-Token` + trusted identity headers) → team+agents persisted as the requesting user → backend reads back the created team from tool results and returns the same `ITeamWithAgentsResponse` (frontend contract unchanged).

## Part 1 — New `mcp-agent/` server (clone mcp-playbook structure)
- `config.py`: env `YELLOWSTORM_BACKEND_URL` (default `http://localhost:3000`), `YELLOWSTORM_INTERNAL_SERVICE_TOKEN`, `AGENT_MCP_INGRESS_TOKEN`, `MCP_PORT=8026`, `AGENT_MCP_TIMEOUT_SECONDS=60`; hand-rolled dataclass + `validate()` like mcp-playbook.
- `auth.py`: adapted `TrustedIdentityMiddleware` (single `Authorization: Bearer` via `compare_digest`, 4 trusted identity headers → contextvars, `/health/*` bypass).
- `contracts.py`: versioned envelope `agent.mcp.v1` (`{schemaVersion, ok, data?, error?, meta}`), success/failure builders, category/retryable mapping.
- `clients/yellowstorm_agent_client.py`: httpx client, `X-Internal-Token` + identity headers, unwrap `{success,data}`, size cap, typed error mapping.
- `server.py`: `FastMCP("Agent MCP")`, tools (snake_case, backend errors → envelope, ids URL-encoded):
  - Agents: `list_agent_types`, `list_agents`, `get_agent`, `create_agent`, `update_agent`, `delete_agent`, `list_models`
  - Teams: `list_teams`, `get_team`, `create_team`, `update_team`, `update_team_hierarchy`, `delete_team`
  - `__main__`: `mcp.run(transport="streamable-http", host="0.0.0.0", port=settings.port, middleware=[...])`; `/health/live`, `/health/ready`.
- `requirements.txt` (fastmcp==2.14.7, httpx, pydantic, pytest, pytest-asyncio), `.env.example`, local `.env` (ingress token generated; internal token matches back `INTERNAL_SERVICE_SECRET`), `README.md`, `Dockerfile`, `.gitignore`/`.dockerignore`.
- `tests/`: mirror mcp-playbook's three layers (in-process `fastmcp.Client` + stub backend; ASGI middleware tests; `httpx.MockTransport` client tests), incl. tool-inventory and envelope-schema assertions.

## Part 2 — Backend internal CRUD endpoints (consumed by mcp-agent)
- New `modules/agent/controllers/agent-crud-internal.controller.ts` and `modules/team/controllers/team-crud-internal.controller.ts`, route prefix `internal/agent-crud`, pattern `@Public()` + `@UseGuards(InternalServiceGuard, <new AgentCrudActorGuard>)` (actor guard: validate/extract `x-yellowstorm-user-id`; modeled on `PlaybookAssistantActorGuard`, requires user-id + correlation-id).
- Endpoints delegate to existing services with the header-derived userId: agent-types `GET /agent-types`; agents `GET /agents`, `GET /agents/:id`, `POST /agents` (CreateAgentDto → `createPersonal`), `PATCH /agents/:id`, `DELETE /agents/:id`; models `GET /models`; teams `GET /teams`, `GET /teams/:id`, `POST /teams`, `PATCH /teams/:id`, `PATCH /teams/:id/hierarchy`, `DELETE /teams/:id`.

## Part 3 — Backend: connector + dedicated agent seeding
- `src/config/agent-mcp.config.ts`: `mcpServerUrl` (`AGENT_MCP_SERVER_URL`, default `http://localhost:8026/mcp`), `mcpIngressToken` (`AGENT_MCP_INGRESS_TOKEN`); register in config loader + Joi schema; add values to `back/.env` (+ example file if present).
- `connector-auth.service.ts` (line ~104): accept `secretKey === 'agent_mcp_ingress'` → Bearer from `agentMcp.mcpIngressToken` (same shape as the playbook branch).
- `ConnectorService.ensureSystemAgentMcpConnector()`: idempotent upsert (`$setOnInsert` by slug, `isSystem: true`, hidden, `streamable_http`, `authSourceType: 'server_config'`, `dynamicHeaders: [{X-YellowStorm-User-Id ← user_id}]`, actions for the 13 tools with parameterSchema + safety read/write/delete).
- `modules/team/constants/team-auto-builder.constants.ts`: type slug `team_builder`, agent slug `team-auto-builder`, connector slug `agent-mcp`, default instruction (team-building methodology using the tools), generation-safe action-key list.
- `modules/team/services/team-auto-builder-bootstrap.service.ts` (`OnApplicationBootstrap`, registered in `TeamModule`): `findOrCreateBySlug` the agent type → ensure connector → `agentRepository.createDefaultSystemAgentIfMissing({... , connectors: [connectorId], connectorActionSelections: [generation-safe keys], temperature: 0.2, llmModel: null → admin default model})`.
- `agent.service.ts` (~line 1035): generalize the identity-header stamping so `agent-mcp` bindings also get `X-YellowStorm-Agent-Id/Conversation-Id/Correlation-Id` (trusted system connector slugs set).

## Part 4 — `generateTeam` rework (team.service.ts)
- Keep: `isEnabled` gate, duplicate-name precheck, existing-agents context.
- Resolve seeded agent via `findActiveDefaultIdBySlugAndType`; missing → `TEAM_AUTO_BUILDER_NOT_CONFIGURED`.
- Build query (user prompt + team name exact + existing agents + reuse hint) → `runSingleAgentTask({userId, agentId, query, attachedFiles: [], correlationId: randomUUID, timeoutMs: 360_000, usageEndpoint: 'team-auto-builder'})`.
- Extract created team id from `toolResults` (tool name ending `create_team`, completed, envelope `data.id`) → `findUserTeamById` → return response. No team created / run failed → log + `TEAM_GENERATE_FAILED` (500) with cause logged.
- Delete now-dead code: `ChatCompletionService` injection + `ChatCompletionModule` import, `buildAgentTemplate`, `buildOutputFormatInstruction`, `parseAiResponse`; update team.service tests.
- Auto-builder config becomes toggle-only: schema/DTO (`{isEnabled}`), admin controller/service unchanged shape, `getConfig` returns `{isEnabled}`.

## Part 5 — Frontend admin simplification (browser-visible)
- `TeamAutoBuilderPage.tsx`: reduce to enable/disable toggle (immediate save), remove model select / system prompt / temperature UI and `getAllModels` call; update admin `api.ts`/`types.ts` (`UpsertTeamAutoBuilderConfigRequest = { isEnabled }`); prune/adjust `admin` locales en+fr (description now points to the library agent).

## Verification
- Python: `cd mcp-agent && conda run -n meta python -m pytest -q` (install requirements into meta first).
- Backend: focused jest for team.service generate paths, new internal controllers, bootstrap seeding, connector-auth branch; then `npm run build` + lint.
- Frontend: vitest for TeamAutoBuilderPage + `npm run build`.
- Gates: `frontend-qa` (admin page change), `reviewer` (Tier 3 — critical/major findings must be resolved), `maintainer` afterwards for the new MCP server contract + architecture note.
- Manual E2E (requires local ADK+backend+mcp-agent running, documented as follow-up): enable toggle → create team via Auto Builder → verify agents+team created and org chart returned.

## Risks / notes
- Generation latency is now a multi-tool agent run — 360 s timeout matches the previous chat-completion budget; frontend already sends `timeout: 0`.
- Seeded connector actions can drift from server tools; admin can refresh via existing `import-mcp` (documented in README).
- Seeded agent has no pinned model → falls back to the admin default model (must exist); documented.