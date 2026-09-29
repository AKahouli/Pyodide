# Playbook MCP

FastMCP Streamable HTTP adapter for the YellowStorm Playbook assistant. NestJS remains authoritative for access, context, validation, construction, optimization, and Advisor evidence.

## Configuration

- `YELLOWSTORM_BACKEND_URL`: NestJS origin, default `http://localhost:3000`.
- `YELLOWSTORM_INTERNAL_SERVICE_TOKEN`: value sent as `X-Internal-Token` to NestJS.
- `PLAYBOOK_MCP_INGRESS_TOKEN`: connector-to-MCP secret sent as `Authorization: Bearer <token>`.
- `MCP_PORT`: Streamable HTTP port, default `8025`.
- `PLAYBOOK_MCP_TIMEOUT_SECONDS`: backend timeout, constrained to 1-300 seconds.
- `PLAYBOOK_MCP_MAX_RESPONSE_BYTES`: maximum buffered backend response, default 2 MiB and maximum 8 MiB.
- `PLAYBOOK_MCP_SEARCH_LIMIT_MAX`: maximum Yellowmind search/list result count, default and maximum `25`.

Bearer authentication is sufficient for MCP initialization and tool inspection. User-scoped tool calls additionally require `X-YellowStorm-User-Id`; callers may provide `X-YellowStorm-Tenant-Id`, `X-YellowStorm-Agent-Id`, `X-YellowStorm-Conversation-Id`, and `X-Correlation-Id` as an optional complete actor envelope for authorization and audit correlation. Identity headers are never model tool arguments.

## Yellowmind

The same MCP server supports the authenticated Yellowmind Playbook-only vertical slice. It returns bounded permission-filtered data and semantic `uiTarget` values. NestJS remains authoritative for object access, validation, generation, diagnostics, and execution.

Yellowmind receives only this runtime-enforced allowlist: `search_playbooks`, `open_playbook_context`, `get_playbook_summary`, `get_task_details`, `get_task_dependencies`, `validate_playbook`, `start_playbook_generation`, `start_playbook_execution`, `list_recent_executions`, `get_playbook_execution`, and `get_execution_diagnostics`. Other tools remain available for approved existing consumers but are not attached to Yellowmind.

`start_playbook_generation` binds to the trusted current Conversation turn and accepts an optional name. It may return typed clarification questions before any draft is created; callers continue with the returned `continuation_id`, typed answers, and optional explicit skip flag. Callers never supply an internal request ID. `start_playbook_execution` requires server-side authorization and a runtime-provided idempotency key. The MCP does not own authorization or confirmation state.

Semantic UI targets contain only allowlisted Yellowmind surfaces and identifiers. The frontend resolves local route templates and enforces unsaved-change guards. This server never operates the DOM, emits arbitrary URLs, or performs mouse/keyboard automation.

The server sends Yellowmind instructions at initialization: names only (never ids; any `playbook_id` also accepts the exact Playbook name, any `task_id` the exact task name), sources and runs are the user's decision. Tools carry MCP `readOnlyHint` / `destructiveHint` annotations.

Sources are chosen by the user, not searched by the assistant. Clarification questions with a `resourceSelector` come back with a `playbook.sources` `uiTarget`; the conversation shows a card backed by the JWT routes `GET /api/v1/playbooks/assistant/clarifications/:continuationId/sources`, `PUT .../questions/:questionId/sources` and `GET /api/v1/playbooks/assistant/source-files?search=` (a searchable list of every workspace and file the user can open). NestJS keeps the picks with the waiting clarification and joins them to the answers when the assistant continues it; chosen workspaces become fixed task inputs and the new Playbook's workspaces.

Personal memory is intentionally outside this server.

No tool responds to runtime HITL. Normal MCP-started construction returns a Playbook canvas deep link and operation ID. The authenticated canvas consumes the durable operation through its JWT construction stream and applies deltas directly with one atomic Undo checkpoint. MCP ingress credentials are never forwarded to the browser.

The YellowStorm Playbook canvas uses its JWT-authenticated `/api/v1/playbooks/:playbookId/intent-constructions/:constructionId/stream` route for Designer-, MCP-, and Advisor-originated operations. Advisor remediation is canvas-owned and remains staged until explicit Apply or Discard.

## Operations

- Liveness: `GET /health/live`.
- Readiness: `GET /health/ready`; readiness fails when required secrets or bounded settings are invalid.
- Inject both secrets through the deployment secret manager. Never put real values in images, manifests, logs, browser configuration, or connector persistence.
- Rotate the ingress token by updating MCP and NestJS together, verify readiness and tool inventory, then allow connector reconciliation.
- Roll back by disabling connector reconciliation first, then the MCP assistant flag.

The approved tool inventory includes canonical inspection, durable construction and Advisor preview, workflow/task optimization, create/clone, revision-safe operation revert, and non-HITL execution operations. It permanently excludes answering, approving, rejecting, blocker disabling, and resuming runtime HITL.
