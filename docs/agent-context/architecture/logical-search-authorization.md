# Logical Search signed workspace authorization

Governing contract: [ADR-0031](../decisions/ADR-0031-logical-search-signed-workspace-scope.md),
with ADR-0017/0018/0023. Source lives across this repository and
`C:/prog/mcp-server-logical-search`. Acceptance does not imply deployed verification.

## Ownership and configuration

- `McpJwtService` reuses the existing RSA issuer and connector renewal endpoint.
  `MCP_WORKSPACE_SCOPE_TTL_SECONDS` in backend `.env` defaults to 180, integer
  1..300. Ordinary non-scoped assertion lifetimes remain unchanged.
- Connector policy explicitly enables `workspaceAuthorization: true`, requires
  verified_user delegation and an audience. For Logical Search use `internal_jwt`
  and `Authorization: Bearer <signed workspace JWT>` only; no static service token.
  Existing privileged connector-policy and revision controls own this field.
- `WorkspaceShareService.readableWorkspaceScope` obtains a bounded canonical ID
  snapshot from PgWorkspaceStore using owner/share/public rules. The bound is
  `MCP_WORKSPACE_SCOPE_MAX_IDS` (default 1000, 1..1000); more than the bound fails
  closed, and the receiver applies its own configured bound. An empty list grants no
  document access. Renewal reloads the snapshot rather than copying previous claims.
- `yellowstorm-adk/src/mcp` renews the bearer JWT and discards editable identity
  headers. Unrelated two-header connectors retain their separate provider/service
  credential contract. Editable headers cannot bootstrap proof.
- Native semantic extraction passes its invoking user to the standalone search
  client. `SEMANTIC_MODEL_NATIVE_SEARCH_CONNECTOR_ID` selects the same protected
  connector; McpJwtService checks requested workspace access and issues the same
  scope for fixed `/search_native` or `/search_native/batch` paths at that receiver's
  exact origin. Requests carry the signed bearer JWT and Workspace-Id; redirects are
  refused. No caller-supplied user ID is sent as proof.
- The external receiver loads its trusted RSA public key once and locally checks
  signatures, issuer/audience, lifetime, structural connector/revision claims and read scope. Every
  requested workspace must be in scope. HTTP is stateless. SQL remains scoped.

## Deployment

Provision external MCP `.env`: `MCP_AUTH_MODE=workspace_assertion`,
`MCP_ENVIRONMENT=production`, `MCP_JWT_PUBLIC_KEY_FILE`, `MCP_JWT_ISSUER`,
`MCP_JWT_AUDIENCE=mcp-logical-search`. No receiver connector/revision pins.
Remove `MCP_API_KEY`. Set `MCP_WORKSPACE_SCOPE_MAX_IDS` to the same value as the
backend (default 1000); a receiver bound lower than the issuer's rejects the scope.
Use only the public counterpart of the backend issuer key.
Per user-approved proposed [ADR-0034](../decisions/ADR-0034-logical-search-offline-authority-without-pins.md),
remove `MCP_JWT_CONNECTOR_ID` and `MCP_JWT_SECURITY_REVISION` from receiver
configuration. Issuer/renewal retains current connector-policy and revision checks.
Previously issued assertions remain valid until expiry (default 180 seconds,
maximum 300); policy changes are not instantaneous receiver revocation. Update
connector and receiver audience together and renew/rebind executions. The public
key, issuer and dedicated audience remain required trust configuration; default
mode/environment/scope-bound entries need not be explicitly repeated in `.env`.
Configure the matching connector through authorized security management, using
`http://localhost:8045/http/` only with the approved exact development egress grant;
production requires protected TLS ingress. Rebuild/restart backend as needed,
restart MCP in conda `logicalsearch`, and rebind agent execution.
Set `SEMANTIC_MODEL_NATIVE_SEARCH_CONNECTOR_ID` on the backend for native semantic
extraction, matching that connector; remove its old static ingress credential.
Missing invoking user or connector configuration fails before native HTTP access.

Connector editor profile/authentication changes must preserve an existing explicit
`workspaceAuthorization: true` while the destination remains compatible. The
privileged **Edit Connector → Security policy → Include workspace read scope**
switch manages this opt-in explicitly (English/French label and helper). It
requires Streamable HTTP, verified-user delegation, an audience and a configured
or internal-JWT profile; ordinary editors do not see the control. Save the changed
policy before inspecting tools. Turning it off for a configured profile also
clears the otherwise-invalid delegation/audience; internal-JWT identity remains.
Supplementary connector field guidance is available through adjacent focusable
help tooltips (pointer or keyboard focus; Escape closes). The workspace switch
also retains a screen-reader description. Persistent labels, credential state,
validation errors and save-before-inspection notices remain visible.
The shared policy comparator includes this field so save and inspection revision
gates cannot overlook its removal. Public/nondelegated or incompatible transport
transitions clear authority; selecting the Logical Search audience alone never
enables it. A saved policy missing this opt-in produces no signed workspace scope
and is rejected by the receiver, including during tool inspection. Restore it only
through privileged, revision-fenced connector management, not a direct DB update.

JWT-only migration follows user-approved proposed [ADR-0033](../decisions/ADR-0033-jwt-only-mcp-callbacks.md).
Deploy issuer/client and receiver together; prior two-header qualification below
is historical and does not qualify this changed wire format. Compose probes now
check TCP listener liveness, not authenticated database readiness. HTTP health
probes still require a valid JWT and allowed network. After permission was enabled,
the three focused receiver suites ran via the existing `logicalsearch` interpreter's
stdlib unittest runner: 62 tests, one platform skip, no failures. The example
configuration is migrated. Cross-repository live runtime qualification remains
separate. Do not provision a permanently hardcoded expiring JWT as a probe.

Workspace identity is the canonical backend ID (indexing `brain_id`), not
`storagePrefix`/alias. Legacy rows using another namespace must be reconciled by
their ingestion owner, never granted access by string aliases in the verifier.

No per-search authorization network lookup exists. Revocation freshness is bounded
by the issued TTL. Backend-only connector/account/share changes cannot instantly
revoke locally verified assertions; update receiver revision to fence old tokens
locally. Keep key/revision rollout coordinated and do not log assertions.

## Verification state (2026-10-19)

- Initial focused issuer/policy/workspace set: 86 tests passed. Subsequent issuer,
  native-search and resolver set: 60 passed; workspace service suite also passed
  after adding snapshot-overflow coverage. Results overlap; do not sum these counts.
- Isolated PostgreSQL owner/share/public snapshot and share-revocation regression
  passed using the repository's POSTGRES_TEST_DB harness. The first run exposed a
  test-fixture mistake (public status must be set with updateFields); corrected and
  rerun successfully, with no change to production authorization logic.
- ADK assertion renewal: 44 passed. Logical Search header-adapter regression: 1
  selected test passed (trusted assertion retained, editable assertion discarded).
- Receiver signed-assertion tests: 5 passed, including production app/lifespan,
  both mounts, tools/resources, concurrent actors, substituted session header,
  narrower replacement scope and mixed-denied batches; protected storage mocked.
  Legacy boundary suite: 21 run, one skipped, otherwise passed, in explicit
  loopback development mode only.
- Local verifier microbenchmark: 1000 checks with 100 signed workspace IDs, median
  0.1051 ms and p95 0.2003 ms, no network calls. This excludes HTTP/SQL/model work
  and is not end-to-end search latency or a production performance guarantee.
- Latest backend build-scoped TypeScript check (`tsconfig.build.json`, no emit)
  passed. The broad unscoped check encounters unrelated templates/scripts errors.

Live local qualification (localhost POC, 2026-10-19) with the receiver public key,
connector policy revision 6 (`workspaceAuthorization`, `verified_user`, audience
`mcp-semantic-model`) and the connector database host pinned to the certificate IP
SAN (`verify-full`):

- Receiver `/health/ready` returns 200 and search executes. Owner and shared-scope
  assertions for workspace `6a9edcaee1ea25a8f0acd9c0` returned 15 results (~2.3s and
  ~0.9s). A user without that workspace, a workspace id absent from the signed scope,
  a missing assertion and an invalid assertion all failed closed (403/401) without
  search execution.
- Backend issuance (`POST /api/v1/connectors/mcp-token/:connectorId`) produced an
  RS256 assertion with `aud mcp-semantic-model`, `iss yellowstorm`, the connector id,
  `securityRevision` 6, TTL 180 and `workspaceScope` v1/read; the receiver denied a
  workspace outside that scope.
- Broad-user bound (ADR-0032): the first run with the 100-ID bound failed closed
  (`403 ERR_1902`) for the owner (114 readable) and shared user (152). After making
  `MCP_WORKSPACE_SCOPE_MAX_IDS` configurable (default 1000) on both sides, issuance
  returned scopes of 114 and 152 IDs (about 5.0 KB and 6.4 KB) that included the
  target workspace, and search returned 15 results for both. A synthetic 1000-ID
  assertion (about 37 KB in the `X-YellowStorm-Mcp-Assertion` header) was accepted
  and executed, so ingress header limits accommodate the configured cap. A user whose
  41-workspace scope excluded the target still received `403 workspace_forbidden`.
- Agent/conversation issuance path: the first in-conversation regenerate failed
  closed with `Invalid MCP authorization`. Root cause was module wiring, not policy:
  `AgentModule` re-declared `McpJwtService` as a local provider without importing
  `WorkspaceModule`, so that instance's `@Optional()` `workspaceShares` was
  `undefined` and `issue()` denied at `mcp-jwt.service.ts:161`. Removing the
  shadowing provider makes the agent runtime use the `ConnectorModule`-exported,
  fully-wired instance (it already imports `ConnectorModule`). Guarded by
  `agent.module.spec.ts`; focused issuer/agent-runtime specs (57) and the
  build-scoped TypeScript check passed, and the reloaded backend returns
  `/api/v1/health` 200. Browser QA then sent a new turn through the classic
  conversation (default agent) and the response streamed to a completed French
  answer with the message POST 201 and no 401/403 or authorization error, so the
  previously failing agent-turn path no longer denies. This confirms the fix for
  the reported symptom; it does not independently prove the turn invoked the MCP
  tool (the earlier direct-endpoint qualification amid 15 results does). Any module
  that provides `McpJwtService` must have `WorkspaceShareService` reachable;
  `TeamModule`'s unused duplicate is a known latent instance of this pattern.

Required auth review passed after fixing saved-credential binding, native-search
producer headers and production transport test coverage; final adapter delta is
reviewed separately. Local receiver and backend-issuer paths, including broad-user
scopes up to the configured bound, are now qualified. Do not infer clean-dependency
or multi-instance deployment qualification from this local run.
