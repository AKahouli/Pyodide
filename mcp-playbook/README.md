# Playbook MCP

FastMCP Streamable HTTP adapter for the YellowStorm Playbook assistant. NestJS remains authoritative for access, context, validation, construction, optimization, and Advisor evidence.

## Configuration

- `YELLOWSTORM_BACKEND_URL`: NestJS origin, default `http://localhost:3000`.
- `YELLOWSTORM_INTERNAL_SERVICE_TOKEN`: value sent as `X-Internal-Token` to NestJS.
- `PLAYBOOK_MCP_INGRESS_TOKEN`: connector-to-MCP secret sent as `X-Playbook-MCP-Token`.
- `MCP_PORT`: Streamable HTTP port, default `8025`.
- `PLAYBOOK_MCP_TIMEOUT_SECONDS`: backend timeout, constrained to 1-300 seconds.
- `PLAYBOOK_MCP_MAX_RESPONSE_BYTES`: maximum buffered backend response, default 2 MiB and maximum 8 MiB.

The system connector must inject the acting user through the dynamic `X-YellowStorm-User-Id` header. The server trusts that header only after validating `X-Playbook-MCP-Token`. Do not expose this connector to workflow task agents.

No tool responds to runtime HITL. Normal MCP-started construction returns a Playbook canvas deep link and operation ID. The authenticated canvas consumes the durable operation through its JWT construction stream and applies deltas directly with one atomic Undo checkpoint. MCP ingress credentials are never forwarded to the browser.

The YellowStorm Playbook canvas uses its JWT-authenticated `/api/v1/playbooks/:playbookId/intent-constructions/:constructionId/stream` route for Designer-, MCP-, and Advisor-originated operations. Advisor remediation is canvas-owned and remains staged until explicit Apply or Discard.

## Operations

- Liveness: `GET /health/live`.
- Readiness: `GET /health/ready`; readiness fails when required secrets or bounded settings are invalid.
- Inject both secrets through the deployment secret manager. Never put real values in images, manifests, logs, browser configuration, or connector persistence.
- Rotate the ingress token by updating MCP and NestJS together, verify readiness and tool inventory, then allow connector reconciliation.
- Roll back by disabling connector reconciliation first, then the MCP assistant flag.

The approved tool inventory includes canonical inspection, durable construction and Advisor preview, workflow/task optimization, create/clone, revision-safe operation revert, and non-HITL execution operations. It permanently excludes answering, approving, rejecting, blocker disabling, and resuming runtime HITL.
