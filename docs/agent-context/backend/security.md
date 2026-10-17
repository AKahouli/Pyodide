# Authentication and rate limiting

Read only the sections needed for the changed behavior. Paths such as `src/`, `drizzle/` and `package.json` are relative to `YellowStorm/back/`; `front/` means `YellowStorm/front/`. Verify descriptive inventories and known debt against current source before relying on them.

## 8. Authentication & Authorization

- **Access token**: short-lived (~15m), `Authorization: Bearer <jwt>`. Payload: `userId`, `sessionId`, `permissions[]`, `roleNames[]`.
- **Refresh token**: long-lived (~7d), HTTP-only `refresh_token` cookie (`httpOnly`, `secure` in prod, `sameSite` configurable). Rotated on every refresh.
- `POST /api/v1/auth/refresh` — frontend axios 401-retry queue depends on this.
- Sessions persisted server-side; `JwtStrategy` validates token + active session.

**Global guard** via `APP_GUARD: JwtAuthGuard` — every route authenticated by default. Opt-out with `@Public()`.

**Current user:** `@CurrentUser()` decorator (from `request.user`). Never read raw JWT claims in controllers.
- `@RequirePermissions('playbook.read')` — `PermissionsGuard`.
- `@Roles('admin')` — `RolesGuard`. Prefer permission checks.

**Secrets:** bcrypt (rounds from `AUTH_BCRYPT_ROUNDS`, default 12). Never log tokens, hashes, cookies, or include secrets in responses/Swagger.

**Widget public-API family (separate from JWT):** `widget-chat` exposes a second, public, non-JWT API family for embedded and integration consumers. Widget tokens are agent-bound, optionally expiring, optionally origin-allowlisted, and are stored **only as SHA-256 hashes** — never log, return, or persist the plaintext token after the one-time creation response. Auth is enforced by `WidgetTokenGuard`, not `JwtAuthGuard`; routes are `@Public()` and may declare a deployment mode (`embed` vs REST integration) that determines whether the consumer receives manual SSE or a synchronous JSON response. There is also a separate synchronous external REST contract at `POST /integrations/agents/:agentId/messages` whose token's agent must equal the route's `:agentId`. When adding widget routes, reuse `WidgetTokenGuard` and the existing deployment-mode shapes rather than introducing a third auth model.

## 14. Rate Limiting

Decorator-driven: `@RateLimit({ limit: 5, windowMs: 60_000, keyPrefix: 'auth:register' })`. Identifier: `${userId ?? ip}:${endpoint}`. Sets `X-RateLimit-*` headers, throws `TooManyRequestsException` (`ERR_1007`) when exhausted. Public endpoints **must** be rate-limited. Skip health checks with `@RateLimitSkip()`.

## 15. Internal service principals and MCP egress (SEC-06/07/08)

**Scoped internal principals (WP-07):** service identity comes from possession of a per-service secret, checked with constant-time comparison — never a plain service-name header. `auth/guards/internal-service-principal.guard.ts` fixes one principal per guard class:

| Principal | Env secret / headers | Endpoint group |
| --- | --- | --- |
| `semantic-model-mcp` | `SEMANTIC_MODEL_MCP_SERVICE_TOKEN`; headers `X-Yellowstorm-Service-Principal` + `X-Yellowstorm-Service-Token` | `internal/semantic-model-assistant/*` only |
| `app-runtime` | `APP_RUNTIME_BIND_TOKEN` (same two headers, principal `app-runtime`) | `internal/app-runtime/*` only |
| `adk-runtime` | `ADK_RUNTIME_MCP_RENEWAL_TOKEN` (same two headers, principal `adk-runtime`) | `connectors/internal/mcp-token` renewal with current signed actor proof only |

The legacy `internal-service.guard.ts` accepts only `INTERNAL_SERVICE_SECRET` and guards the remaining non-semantic internal routes (bounded compatibility path with a removal gate); it never accepts `APP_RUNTIME_BIND_TOKEN`. The original semantic/app scoped tokens are required (min length 16) at startup when `NODE_ENV=production`. The ADK renewal secret is optional when renewal is unused; if configured it requires at least 16 characters. Every principal denies requests when its secret is unset.

**MCP profile and control plane (ADR-0017/0018):** JWT is one selected profile,
not mandatory for every MCP. Existing connector rows own typed `mcpSecurityPolicy`
and monotonic `securityRevision` (migration `0049`). Profiles are `configured`
(existing credential/account resolution), `internal_jwt` (C1) and explicit `public`.
Audience, verified-user delegation, required permissions and an exact private-network
exception are separate controls. No slug, URL list or `isSystem` flag grants trust.
The existing editor shows connection/auth first, specialist settings collapsed, and
requires save before testing current persisted policy. Signing keys and receiving
verifiers remain deployment-managed. A simple saved bearer value uses a literal
custom Authorization mapping so it is not concatenated with a per-user token.

**Privileged writes:** `connectors.security.manage` is required in addition to the
normal create/update permission for policy changes and trust-bearing destination/auth
changes. Existing `connectors.*`/global wildcard semantics include it. Omitted fields
preserve stored policy/secrets; binding-affecting updates require an expected revision
and increment it atomically. Direct catalog overwrite cannot bypass the trusted
connector fence; new/imported rows gain no trust automatically. Explicit Public
transitions clear old credential/header configuration. A disabled connector can be
revoked without granting new authority; reactivation of privileged policy is restricted.

**MCP actor chain:** Semantic Model MCP uses explicit stateless Streamable HTTP and
backend-issued RS256 JWTs (C1 maximum 300s, trusted issuer/audience, duplicate
Authorization rejection). Verification does not mutate ambient context; actor,
assertion and logging values are reset on every exit. Application conversations are
not transport sessions. The verified token is forwarded as `X-YellowStorm-Mcp-Assertion`
under a separate authenticated semantic service principal. `McpJwtService` and
`SemanticAssistantActorGuard` check the trusted expected audience, current connector
ID/revision, active account, required permissions and verified-user delegation before
domain resource checks. A naked user-id header remains developer Bearer compatibility
only; production Semantic MCP requires JWT.

**Issuance/renewal:** user issuance derives the subject from authenticated application
identity. `src/mcp/jwt_auth.py` renews under the dedicated ADK principal using
`{connectorId, assertion}`; no caller-selected subject or URL is accepted. Expired,
wrong-connector or stale-policy proof requires authenticated rebinding. Current
backend policy is read without an authority cache; already-authorized in-flight
operations are not retroactively canceled. Short-lived JWT expiry alone is not an
immediate revocation mechanism at an independent receiving MCP.

**MCP egress:** current connector policy supplies exact exceptions to
`connector/utils/mcp-destination-policy.util.ts` before credential resolution.
Production requires TLS, including internal exceptions. Public destinations use the
port allowlist and deny private/reserved addresses. Approved exact private targets
still resolve hostnames and reject metadata/link-local/reserved destinations. Default
resolution uses the OS resolver with all returned addresses checked, including system
hostname mappings; direct DNS queries are not required. Resolution errors, empty
results and a six-second caller deadline fail closed. The deadline does not cancel
the underlying OS lookup. Lookalike
hosts, paths and redirects inherit nothing. Backend inspection refuses redirects
including the SSE hop. Runtime clients reject redirects for every profile and check
destinations before attaching credentials: Streamable HTTP binds origin/path/query;
legacy SSE permits its separate protocol POST path only on the configured origin.
SDK/httpx diagnostics are suppressed only within the task-local MCP HTTP scope to
avoid credential-bearing URL leakage; context is restored afterward. Evidence calls
require resolved auth that is actually attached, not raw secret headers that their
transport intentionally strips. DNS-rebinding
between validation and connection still requires deployment network egress controls.

**Rollout:** apply `0049` through the existing migration process, provision the
dedicated renewal secret on backend/ADK, configure signer/verifier and explicitly
grant policy to approved connector IDs. Old environment URL lists no longer grant
identity/egress/JWT authority. A bounded signer-key compatibility adapter accepts
legacy keys until shared settings replace them. Do not restore unsafe sessions or
user-id-only renewal during rollback. See [ADR-0018](../decisions/ADR-0018-connector-managed-mcp-security.md).
