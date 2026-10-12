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
