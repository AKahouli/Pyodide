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
Backend errors are returned as failure envelopes (never raised); only argument validation
and missing identity raise MCP tool errors.

## Authentication model

- **Ingress (this server ← caller)**: `Authorization: Bearer $AGENT_MCP_INGRESS_TOKEN`.
  The caller (YellowStorm backend, through ADK connector bindings) additionally stamps the
  trusted identity headers `X-YellowStorm-User-Id`, `X-YellowStorm-Agent-Id`,
  `X-YellowStorm-Conversation-Id`, `X-Correlation-Id`. All four must be present for a
  tool call to run; bearer-only is enough for `initialize`/`list_tools`.
- **Egress (this server → backend)**: every call to
  `/api/v1/internal/agent-crud/*` carries `X-Internal-Token: $YELLOWSTORM_INTERNAL_SERVICE_TOKEN`
  (same value as the backend `INTERNAL_SERVICE_SECRET`) plus the identity headers above.
  The backend resolves the acting user from `X-YellowStorm-User-Id`.

## Configuration

Copy `.env.example` to `.env` (auto-loaded; real environment variables win):

| Variable | Default | Purpose |
|---|---|---|
| `YELLOWSTORM_BACKEND_URL` | `http://localhost:3000` | NestJS backend base URL |
| `YELLOWSTORM_INTERNAL_SERVICE_TOKEN` | — (required) | Must match backend `INTERNAL_SERVICE_SECRET` |
| `AGENT_MCP_INGRESS_TOKEN` | — (required) | Must match backend `AGENT_MCP_INGRESS_TOKEN` |
| `MCP_PORT` | `8026` | HTTP listen port |
| `AGENT_MCP_TIMEOUT_SECONDS` | `60` | Backend call timeout (1–300) |
| `AGENT_MCP_MAX_RESPONSE_BYTES` | `2097152` | Response size cap |
| `AGENT_MCP_LIST_LIMIT_MAX` | `25` | Unused lists clamp (reserved) |

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
