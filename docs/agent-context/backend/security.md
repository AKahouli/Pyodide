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

**MCP actor chain:** Semantic Model, agent and playbook MCPs use explicit stateless
Streamable HTTP and backend-issued RS256 JWTs (C1 maximum 300 seconds, trusted
issuer/audience, duplicate Authorization rejection). The agent/playbook production
entrypoints set `stateless_http=True`; their JWT checks require integer `iat`/`exp`
with `0 < exp - iat <= 300` and reject conflicting user headers.
Their middleware obtains identity from the signed `sub`, keeps
actor/assertion/logging context request-local, and uses `ExitStack` to restore prior
context on rejection, success, exceptions, cancellation and partial setup failures.
Application conversations are not transport sessions. The verified token is
forwarded as `X-YellowStorm-Mcp-Assertion` under each MCP's separate authenticated
service principal. `McpJwtService` verifies the credential and re-checks the current
connector ID/revision, active account, required permissions and verified-user
delegation before domain resource checks; the backend `DelegatedActorGuard` derives
the actor from the signed assertion and retains the invoking user's permission
ceiling. Agent/playbook evidence exercises the production FastMCP ASGI entrypoints,
concurrent Alice/Bob requests, foreign legacy-session replay, renewed assertion
forwarding to mock backends, rejection without dispatch, and nested/actual task
cancellation cleanup. These focused MCP tests passed separately (agent: 55;
playbook: 66); the required scoped security review passed with no blocking findings.
The delegated guard and Agent/Playbook controller suites passed (24 tests).
The MCP tests mock the backend transport, so they do not prove real renewal issuance
or deployed end-to-end authorization. This is not blanket security certification.
Deployments must restart/redeploy MCP
processes to load the stateless entrypoint configuration; this source/test evidence
does not confirm any environment's rollout state.

`DelegatedActorGuard` (ADR-0024) is the single shared delegated-user guard for the
platform-trusted MCP surface: the actor comes only from the signed assertion, a
naked user-id header is never an identity source, and the absence of an assertion
fails closed. It applies no per-route audience fence, so a trusted MCP may act for
the verified user on any internal route — always bounded by that user's own
permissions. The semantic-model, playbook and agent-crud surfaces use it; for
agent-crud that is the agent and team routes under `internal/agent-crud` served for
connector `agent-mcp`. Every migrated connector must carry `internal_jwt` +
`verified_user` policy so the backend mints the assertion the MCP server forwards as
`X-YellowStorm-Mcp-Assertion`.

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
port allowlist and deny private/reserved addresses. A per-connector
 `allowInsecureHttp` policy grant permits plain HTTP only outside production,
alongside the legacy development environment flag; the privileged security
permission gates it like other policy fields. Legacy rows without the key
normalize to `false`; a stored grant is privileged destination authority, so
ordinary connector editors cannot move or reactivate such connectors, and the
shared destination-option resolution
(`resolveMcpDestinationPolicyOptions`) applies the same grant to inspection,
runtime tool calls and evidence execution. Approved exact private targets
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

**Semantic MCP ingress modes:** the semantic MCP server selects `JWT` or `Bearer`
from its own configuration (`SEMANTIC_MODEL_MCP_AUTH_MODE` in `mcp/mcp-semantic-model`);
production must be `JWT` and that contract is enforced there, not in the backend.
Bearer requires its separate ingress secret and production HTTPS at the deployment
ingress. Both modes still require the matching backend/MCP
`SEMANTIC_MODEL_MCP_SERVICE_TOKEN`. A static ingress token does not establish a
verified user: Bearer mode does not supply the signed actor assertion required by
backend semantic-assistant operations. The existing delegated-user path therefore
uses JWT; enabling Bearer ingress does not relax backend actor authorization,
connector policy or egress controls.

**Rollout:** apply `0049` through the existing migration process, provision the
dedicated renewal secret on backend/ADK, configure signer/verifier and explicitly
grant policy to approved connector IDs. Old environment URL lists no longer grant
identity/egress/JWT authority. A bounded signer-key compatibility adapter accepts
legacy keys until shared settings replace them. Do not restore unsafe sessions or
user-id-only renewal during rollback. See [ADR-0018](../decisions/ADR-0018-connector-managed-mcp-security.md).
