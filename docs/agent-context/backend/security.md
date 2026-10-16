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
| `semantic-model-mcp` | `SEMANTIC_MODEL_MCP_SERVICE_TOKEN`; headers `X-Yellowstorm-Service-Principal` + `X-Yellowstorm-Service-Token` | `internal/semantic-model-assistant/*`, `connectors/internal/mcp-token` |
| `app-runtime` | `APP_RUNTIME_BIND_TOKEN` (same two headers, principal `app-runtime`) | `internal/app-runtime/*` only |

The legacy `internal-service.guard.ts` accepts only `INTERNAL_SERVICE_SECRET` and guards the remaining non-semantic internal routes (bounded compatibility path with a removal gate); it never accepts `APP_RUNTIME_BIND_TOKEN`. Both scoped tokens are required (min length 16) at startup when `NODE_ENV=production` and deny per request when unset (fail closed).

**MCP actor chain (WP-06):** the semantic MCP server authenticates callers with backend-issued RS256 JWTs (`SEMANTIC_MODEL_MCP_AUTH_MODE=JWT`, enforced for production in `config.schema.ts` and the Python server's startup validation; max lifetime 300s, exact issuer/audience, duplicate Authorization headers rejected). The verified original token is forwarded as `X-YellowStorm-Mcp-Assertion`; the backend (`SemanticModelMcpJwtService.verifyMcpAssertion` + `SemanticAssistantActorGuard`) derives the acting user from its signed `sub`, rejects header disagreement, and treats a naked `X-YellowStorm-User-Id` as authoritative only in developer Bearer mode. ADK token renewal (`src/flow_engine/mcp/jwt_auth.py`) uses the same principal headers.

**MCP destination/egress policy (WP-05):** every server-side probe of a user-configured MCP destination passes `connector/utils/mcp-destination-policy.util.ts` before any transport is built — https-only outside the `MCP_EGRESS_ALLOW_INSECURE_HTTP` development opt-in, `MCP_EGRESS_ALLOWED_PORTS` allowlist (default 80/443/8443), no userinfo/fragment/malformed percent-encoding, all A/AAAA records resolved with loopback/link-local/RFC1918/ULA/CGNAT/benchmark/multicast/metadata ranges (v4+v6, literal and mapped) denied, redirects refused on every hop including the SSE `eventsource` layer via a fetch override. Exact admin-configured internal endpoints are the only exception — and only while the owning service's MCP auth mode is JWT (`PLAYBOOK_MCP_SERVER_URL`/`AGENT_MCP_SERVER_URL`/`SEMANTIC_MODEL_MCP_SERVER_URL` gated on their `*_MCP_AUTH_MODE`), because the exception contract requires service-issued JWT authentication; Bearer-mode internal servers satisfy the public rules like any other endpoint, `TRUSTED_MCP_SERVER_URLS` grants identity headers but never an egress bypass, and lookalike URLs inherit nothing (canonical exact match). Admin inspection runs the policy before any OAuth token retrieval. Denials are deterministic 400 `ERR_3103`; telemetry logs actor, normalized host and reason only. DNS-rebinding between validation and connect is contained by deployment egress rules (WP05.6) — application filtering is defense in depth.
