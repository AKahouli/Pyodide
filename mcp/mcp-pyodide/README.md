# mcp-pyodide — Browser Python MCP Server

FastMCP server (Streamable HTTP, `/mcp`, default port `8027`) exposing a single tool, `execute_python`, that
runs bounded Python in the **user's connected Yellowmind browser** through the YellowStorm pyodide-runtime
relay. The MCP process never executes Python itself.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `YELLOWSTORM_BACKEND_URL` | `http://localhost:3000` | NestJS backend base URL |
| `MCP_JWT_PUBLIC_KEY_FILE` | — | PEM public key matching the backend MCP signer |
| `MCP_JWT_ISSUER` | `yellowstorm` | Expected assertion issuer |
| `MCP_JWT_AUDIENCE` | `mcp-pyodide` | Expected assertion audience |
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
python server.py          # stateless streamable-http on 0.0.0.0:8027/mcp
```

## Trusted identity

Every non-health request needs `Authorization: Bearer <signed MCP assertion>` — the short-lived,
backend-signed RS256 assertion minted per connector (issuer `yellowstorm`, audience `mcp-pyodide`,
lifetime ≤ 300s). The acting user is taken **only** from the verified token subject; a spoofable
`X-YellowStorm-User-Id` header is rejected unless it matches the signature. Missing, expired,
foreign-audience or invalid-signature assertions fail closed with 401. The retired
`x-pyodide-mcp-token` static credential is denied on every route.
`X-YellowStorm-Agent-Id`, `X-YellowStorm-Conversation-Id` and `X-Correlation-Id` are optional
tracing context, and `workspace_id` / `X-YellowStorm-Input-Files` carry the connector binding's
workspace context. The model never controls these values: they come from the connector binding.

## Tool

```
execute_python(
    code: str,
    input: any = null,
    timeout_seconds: int = 30,
    inputs: list[str] = [],
    outputs: list[str] = [],
) -> PyodideExecutionResultV1
```

`inputs`/`outputs` are the §27 workspace-file extension: **logical references only** (exact workspace file
names), never a storage path or URL. Inputs are mounted read-only under `/workspace/input`; files written to
`/workspace/output` and named in `outputs` are persisted by YellowStorm and returned as bounded `artifacts`
references (no file content through MCP). Sizes/limits remain those of the MVP.

## Connect it to an agent

1. **Admin → Connectors → New connector**: MCP, transport *Streamable HTTP*, URL `http://<host>:8027/mcp`,
   security profile *Internal JWT* with audience `mcp-pyodide` and verified-user delegation.
2. **Agent edit → Connectors**: add the connector and select `execute_python`. A Playbook task can bind the
   same connector/action.

## Tests

```bash
pytest tests -q
```
