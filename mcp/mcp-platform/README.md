# YellowStorm Platform MCP

One modular MCP server for YellowStorm domain tools, backed by the existing
backend internal assistant routes. Phase 1 mounts the Playbook tool module,
ported unchanged from `mcp/mcp-playbook` (same tool names, inputs/outputs,
annotations and `playbook.mcp.v1` results, including the streaming construction
event path). Callback authentication is JWT-only per ADR-0033: the backend-signed
RS256 assertion is the only credential, with audience `mcp-platform`, verified
fail-closed. Transport is stateless streamable-http per ADR-0018.

## Layout

- `config.py` — single `Settings` model (`.env` setdefault pattern), shared deployment config
- `auth.py` — JWT-only ingress middleware + request-local actor context
- `contracts.py` — `playbook.mcp.v1` result contracts
- `clients/base.py` — shared backend plumbing: HTTP session, timeout, response cap, signed-assertion forwarding, error translation
- `clients/yellowstorm_playbook_client.py` — Playbook backend client (`PLAYBOOK_*` error codes preserved)
- `tools/playbook_tools.py` — all Playbook tools + `/construction-events/...` SSE route
- `server.py` — FastMCP stateless streamable-http server, health routes, module registry

## Adding a tool module

Create `tools/agent_tools.py` (or `tools/semantic_tools.py`) exposing
`INSTRUCTIONS` (str) and `register(mcp, settings)`, then add the module to
`MODULES` in `server.py`. `register_tools` mounts it; clients subclass
`clients.base.YellowStormBackendClient` with their own error prefix/type.

## Run

```powershell
# install: python -m pip install -r requirements.txt
# (the unified-logging wheel is staged by scripts/observability/build-sdks.mjs first)
conda run -n meta python server.py
```

Health probes: `GET /health/live` and `GET /health/ready` (unauthenticated).

## Tests

```powershell
$env:PYTHONNOUSERSITE='1'; conda run -n meta pytest -o pythonpath=. tests -q
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `YELLOWSTORM_BACKEND_URL` | `http://localhost:3000` | Backend base URL |
| `MCP_JWT_PUBLIC_KEY_FILE` | — (required) | Public PEM of the backend JWT signing key |
| `MCP_JWT_ISSUER` | `yellowstorm` | Expected JWT issuer |
| `MCP_JWT_AUDIENCE` | `mcp-platform` | Expected JWT audience |
| `MCP_TRANSPORT` | `streamable-http` | Only `streamable-http` (stateless) is supported |
| `HOST` / `PORT` | `0.0.0.0` / `8030` | Listen address (port distinct from sibling MCPs) |
| `MCP_TIMEOUT_SECONDS` | `190` | Shared backend client timeout |
| `MCP_MAX_RESPONSE_BYTES` | `2097152` | Shared backend response cap |
| `PLAYBOOK_MCP_SEARCH_LIMIT_MAX` | `25` | Playbook-specific search bound |

No static ingress/backend service credential exists or is accepted (ADR-0033).
