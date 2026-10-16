# YellowStorm MCP servers

Each MCP is an independently runnable FastMCP service with a flat entry point,
`.env.example`, dependency manifest, Dockerfile, README and focused tests. The
existing `mcp-agent`, `mcp-playbook`, `mcp-semantic-model` and `mcp-pyodide`
servers remain unchanged by this integration.

## Integrated servers

| Directory | Upstream source | Default port | Provider boundary |
|---|---|---:|---|
| `mcp-outlook` | `YellowsysOrg/mcp-outlook` @ `73d6aa7` | 8005 | Microsoft Graph via server-side `M365_ACCESS_TOKEN` |
| `mcp-manus` | `YellowsysOrg/mcp-manus` @ `fe9781b` | 8001 | Sandbox manager via separate `SANDBOX_MANAGER_TOKEN` |
| `mcp-team` | `YellowsysOrg/mcp-teams` @ `2f5fcb4` | 8003 | Microsoft Graph via server-side `M365_ACCESS_TOKEN` |
| `mcp-sharepoint` | `YellowsysOrg/mcp-sharepoint` @ `4912f28` | 8004 | Microsoft Graph and Ceph via server-side credentials |

The requested `mcp-team` URL returned `Repository not found`; `mcp-teams` was
used after verifying its public `main` branch. This substitution is recorded so
the source can be corrected if the original repository is later published.

## Security contract

HTTP MCP ingress follows ADR-0017 profile C. Outlook, Team and SharePoint
authenticate before MCP dispatch with JWT C1 by default (or explicitly selected
private bearer mode); Manus requires its `MCP_API_KEY` at startup. Ingress
credentials are never forwarded to Microsoft Graph or the sandbox manager.
Provider credentials are server-side configuration; any unauthenticated health
route remains limited to liveness/readiness where an upstream server exposes it.

These services are not public listeners. Production deployment still requires
TLS, restricted network reachability, secret-manager injection, least-privilege
provider permissions, bounded storage/download settings, non-root containers,
and deployment-specific authorization/resource allowlists.

## Verification

Run tests from each service directory with `python -m pytest -q`. The source
tests were imported unchanged except for the Outlook test-only provider-token
fixture. Environment-specific blockers observed during integration are tracked
in the task delivery: missing LibreOffice/pypdf integration support and an
already-installed MCP SDK v2 conflicting with Manus's declared `mcp<2` range.
