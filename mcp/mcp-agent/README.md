# mcp-agent — Agent & Team CRUD MCP Server

Standalone [FastMCP](https://gofastmcp.com/) server exposing YellowStorm agent and team
management as MCP tools over **Streamable HTTP** (default port `8026`, endpoint `/mcp`).
The backend seeds it as the hidden system connector `agent-mcp`; attach that connector to
any library agent that needs governed agent/team CRUD tools.

## Tools

| Area | Tools |
|---|---|
| Agents | `list_agent_types`, `list_models`, `list_agents`, `get_agent`, `create_agent`, `update_agent`, `delete_agent` |
| Teams | `list_teams`, `get_team`, `create_team`, `update_team`, `update_team_hierarchy`, `delete_team` |

Every tool returns the versioned envelope `agent.mcp.v1`: `{schemaVersion, ok, data?, error?, meta}`.
Every tool also accepts an optional `workspace_id` argument (injected by the connector runtime
with the selected workspace) which is ignored — agent/team CRUD is not workspace-scoped.
Backend errors are returned as failure envelopes (never raised); only argument validation
and a missing acting user raise MCP tool errors.

## Authentication model

- **Ingress (this server ← caller)**: `Authorization: Bearer <signed MCP JWT>` on
  every request, including initialization and discovery. JWT is the default and
  only supported startup mode; `Bearer` mode is rejected, with no static fallback.
  Configure `AGENT_MCP_JWT_PUBLIC_KEY_FILE`,
  `AGENT_MCP_JWT_ISSUER`, and `AGENT_MCP_JWT_AUDIENCE=mcp-agent`. The server verifies
  YellowStorm's five-minute RS256 token and uses signed `sub` as the acting user,
  rejecting a caller-supplied user header that disagrees with it. Required integer
  time claims must satisfy `0 < exp - iat <= 300` seconds. Connector and ADK calls renew it. Agent
  ownership and shares are checked by the backend on each operation.
- **Egress (this server → backend)**: every call to
  `/api/v1/internal/agent-crud/*` carries only the current signed identity in
  `X-YellowStorm-Mcp-Assertion` and `X-Correlation-Id` (no static service credential).
  The backend verifies route audience, connector/revision and current access; its
  `DelegatedActorGuard` derives the user from that signed assertion, never a naked
  user-id header. The invoking user's permissions, ownership and shares remain
  authoritative. Missing assertions fail before a backend request is sent.

### Request isolation

The production entrypoint explicitly uses `stateless_http=True`. Every HTTP request
authenticates independently; an old or foreign `Mcp-Session-Id` cannot select an
actor or retain an initialization assertion. Actor, assertion and logging bindings
restore their previous values after success, rejection, exceptions, cancellation
and partial setup. Renewed assertions are forwarded on the current call.

`tests/test_request_isolation.py` exercises the production entrypoint with real
FastMCP default SSE responses and the actual backend client against a mock backend:
initialization/discovery, concurrent users, legacy-session replay, renewal,
rejections without downstream calls, nested context and task cancellation. This is
local regression coverage, not deployment certification. Restart existing MCP
processes to activate the change; do not roll back to stateful identity retention.

## Configuration

Copy `.env.example` to `.env` (auto-loaded; real environment variables win):

| Variable | Default | Purpose |
|---|---|---|
| `YELLOWSTORM_BACKEND_URL` | `http://localhost:3000` | NestJS backend base URL |
| `AGENT_MCP_AUTH_MODE` | `JWT` | Only accepted mode |
| `AGENT_MCP_JWT_PUBLIC_KEY_FILE` | — (required) | Mounted public PEM path |
| `AGENT_MCP_JWT_ISSUER` | — | Must match the backend signer |
| `AGENT_MCP_JWT_AUDIENCE` | `mcp-agent` | Dedicated audience for this MCP |
| `MCP_PORT` | `8026` | HTTP listen port |
| `AGENT_MCP_TIMEOUT_SECONDS` | `60` | Backend call timeout (1–300) |
| `AGENT_MCP_MAX_RESPONSE_BYTES` | `2097152` | Response size cap |

Configure the backend with canonical `MCP_JWT_PRIVATE_KEY_FILE` and `MCP_JWT_ISSUER`;
mount only the matching public PEM here. Key/issuer/audience must be nonblank.
Retired ingress/backend service-token variables are not read. Restart the MCP
after provisioning JWT trust; other connector auth profiles are unchanged.

## Run locally

```bash
pip install -r requirements.txt
python server.py          # streamable-http on 0.0.0.0:8026/mcp
```

Health: `GET /health/live` (liveness, unauthenticated), `GET /health/ready` (config validation).

## Connector catalog

The backend seeds the `agent-mcp` system connector (hidden, `streamable_http`) at startup
(`AgentMcpConnectorBootstrapService`). To give an agent these tools, attach the connector
in the agent library; per-agent action restrictions apply as for any connector. Connector
actions are persisted snapshots: after changing the tool set in `server.py`, refresh the
connector via the admin MCP import so parameter schemas stay in sync.

## Tests

```bash
python -m pytest -q
```
