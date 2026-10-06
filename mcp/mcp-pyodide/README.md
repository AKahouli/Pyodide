# mcp-pyodide — Browser Python MCP Server

FastMCP server (Streamable HTTP, `/mcp`, default port `8027`) exposing a single tool, `execute_python`, that
runs bounded Python in the **user's connected Yellowmind browser** through the YellowStorm pyodide-runtime
relay. The MCP process never executes Python itself.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `YELLOWSTORM_BACKEND_URL` | `http://localhost:3000` | NestJS backend base URL |
| `YELLOWSTORM_INTERNAL_SERVICE_TOKEN` | — | Sent as `X-Internal-Token`; must equal the backend `INTERNAL_SERVICE_SECRET` |
| `PYODIDE_MCP_INGRESS_TOKEN` | — | Bearer token agents must present; stored on the connector |
| `PYODIDE_MCP_TIMEOUT_SECONDS` | `100` | HTTP timeout toward the backend |
| `MCP_PORT` | `8027` | HTTP listen port |
| `PYODIDE_MCP_MAX_CODE_BYTES` | `65536` | Maximum code size |
| `PYODIDE_MCP_MAX_INPUT_BYTES` | `2097152` | Maximum JSON input size |
| `PYODIDE_MCP_MAX_RESULT_BYTES` | `524288` | Maximum result size |
| `PYODIDE_MCP_MAX_LOG_BYTES` | `262144` | Maximum aggregate stdout/stderr |
| `PYODIDE_MCP_MAX_QUEUE` | `3` | Backend relay queue bound |

## Run

```bash
pip install -r requirements.txt
python server.py          # streamable-http on 0.0.0.0:8027/mcp
```

## Trusted identity

Every non-health request needs `Authorization: Bearer <PYODIDE_MCP_INGRESS_TOKEN>` and a trusted
`X-YellowStorm-User-Id`. `X-YellowStorm-Agent-Id`, `X-YellowStorm-Conversation-Id` and `X-Correlation-Id` are
optional tracing context. The model never controls these values: they come from the connector binding.

## Tool

```
execute_python(
    code: str,
    input: any = null,
    timeout_seconds: int = 30,
    inputs: list[{document_id?|name?, as?}] = [],
    outputs: list[str] = [],
) -> PyodideExecutionResultV1
```

`inputs`/`outputs` are the §27 workspace-file extension: **logical references only** (a workspace document id,
or an exact file name), never a storage path or URL. Inputs are mounted under `/workspace/input`; named files
from `/workspace/output` are persisted by YellowStorm and returned as bounded `artifacts` references (no file
content through MCP). Sizes/limits remain those of the MVP.

## Connect it to an agent

1. **Admin → Connectors → New connector**: MCP, transport *Streamable HTTP*, URL `http://<host>:8027/mcp`,
   authentication *Bearer token* with `PYODIDE_MCP_INGRESS_TOKEN`. Discover the tools.
2. Make sure the backend's `PYODIDE_MCP_SERVER_URL` is exactly that URL so the connector receives the acting
   user's identity.
3. **Agent edit → Connectors**: add the connector and select `execute_python`. A Playbook task can bind the
   same connector/action.

## Tests

```bash
pytest tests -q
```
