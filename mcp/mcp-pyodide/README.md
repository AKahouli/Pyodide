# mcp-pyodide — YellowStorm Runtime MCP Server

FastMCP server (Streamable HTTP, `/mcp`, default port `8027`) exposing **two toolsets on one endpoint**:

- `execute_python` — runs bounded Python in the **user's connected Yellowmind browser** through the
  YellowStorm pyodide-runtime relay. The MCP process never executes Python itself; the browser does.
- The **Manus sandbox tools** (vendored from [YellowsysOrg/mcp-manus](https://github.com/YellowsysOrg/mcp-manus),
  `sandbox_mcp` package): `sandbox_create`, `sandbox_info`, `sandbox_destroy`, `shell_exec`, `file_read`,
  `file_write`, `file_list`, `file_find`, `file_delete`, `file_upload_base64`, `file_download_base64`,
  `send_file_to_user`. They run commands and manage files inside a Firecracker microVM reached through the
  sandbox manager.

Routing is agent-level (server instructions + the `smart-code-runtime` skill): **Pyodide first** for
calculations, data transformations and small documents; the sandbox only for work Pyodide cannot do (shell,
native binaries, pip/apt system packages, very large or long-running jobs). One task, one runtime.

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
| `SANDBOX_MANAGER_URL` | `http://sandbox.yellowsys.org` | Sandbox manager boundary (Manus tools) |
| `SANDBOX_MANAGER_TOKEN` | — | Manager bearer token (secret — never commit) |
| `SANDBOX_ADDRESS` | — | Dev-only: fixed VM IP, skips the manager |
| `SANDBOX_TTL_MINUTES` | `30` | Idle sandbox lifetime before eviction |
| `SANDBOX_PUBLISH_TIMEOUT_SECONDS` | `120` | `send_file_to_user` Ceph-copy timeout (1–600) |

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

The sandbox tools additionally read the canonical runtime scope headers
(`x-user-id`, `x-conversation-id`, `x-sandbox-scope-*`, `x-workspace-paths`) that the backend stamps on the
connector binding (`applySandboxScopeHeaders`, pyodide* slugs); requests to `/mcp` without a user and
conversation id are rejected with 400. There is no second auth mechanism: the JWT middleware is the single
ingress; the inner sandbox middleware only extracts request context into `ContextVar`s.

## Tools

### Pyodide (browser)

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

### Manus sandbox (Firecracker microVM)

Contract paths inside the VM: READ `/mnt/workspace/<workspace>/` (user inputs, read-only) and
`/mnt/yellowmind/run/artifacts/`; WORK `/mnt/yellowmind/scratch/<lane>`; DELIVERABLES
`/mnt/yellowmind/run/outputs/` (legacy alias top-level `/home/ubuntu/<file>`). `send_file_to_user(path)`
publishes a deliverable to the conversation storage through the manager (`resolve_ceph_path`) and the ADK
projects it into the conversation as an artifact card — same contract as the Code Interpreter connector.

## Connect it to an agent

1. **Admin → Connectors → New connector**: MCP, transport *Streamable HTTP*, URL `http://<host>:8027/mcp`,
   security profile *Internal JWT* with audience `mcp-pyodide` and verified-user delegation.
2. **Agent edit → Connectors**: add the connector and select `execute_python` plus the sandbox tools the
   agent should be able to use. A Playbook task can bind the same connector/action.

## Tests

```bash
pytest tests -q
```

The `sandbox_mcp` package is vendored from the upstream repository's `develop` branch (client, runtime,
manager, eviction, tests) with two integration adaptations: tools are registered on the host FastMCP
instance (`register_sandbox_tools`, no nested server) and read manager/runtime from module state installed
by `make_sandbox_lifespan()` instead of the MCP `Context`; the upstream `MCP_API_KEY` gate is intentionally
absent because the JWT middleware is the single ingress.
