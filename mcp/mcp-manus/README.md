# Manus Sandbox MCP

YellowStorm integration of the upstream Firecracker sandbox MCP. The upstream
`sandbox_mcp` package, tools, runtime and tests are retained; `main.py` follows
the standalone FastMCP server convention used by the other MCPs in this
repository.

## Transport and security

The server exposes Streamable HTTP and requires `MCP_API_KEY` on startup. Every
HTTP MCP request must carry exactly one `Authorization: Bearer ...` credential.
The key is an internal workload credential (ADR-0017 profile C), not a user
identity. User and run headers are accepted only for the existing sandbox
namespace contract and must be supplied by the authenticated YellowStorm
runtime. The sandbox manager credential is separate and is never taken from the
incoming request.

Do not expose this listener publicly. `SANDBOX_ADDRESS` is development-only and
must not be combined with `SANDBOX_MANAGER_TOKEN`. Production deployments must
use the manager boundary, a secret manager, TLS and a non-root container.

## Configuration and tests

Copy `.env.example`, set a random `MCP_API_KEY`, and configure the sandbox
manager. Install `requirements.txt`, then run `python -m pytest -q`.
