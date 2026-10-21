---
id: ADR-0033
status: accepted
scope: first-party-mcp-security-baseline
proposed_at: 2026-10-20
accepted_at: 2026-10-21
---

# First-party MCP security baseline (JWT-only authority)

## Intent and approval

The user approved JWT-only semantic, Playbook, Agent and Logical Search MCP
authentication on 2026-10-20, with no legacy fallbacks, and on 2026-10-21 made
this record the **security baseline every first-party MCP must satisfy** — new
development included. It supersedes, within this scope only, ADR-0024's separate
machine-secret requirement and ADR-0031's additional static ingress credential.
Accepted historical records remain unchanged.

Every requirement below has been applied to at least one shipped MCP
(mcp-sharepoint, mcp-team, mcp-outlook, mcp-platform consolidating
Playbook/Agent/Team/Semantic, mcp-pyodide, and the external Logical Search
server) and is enforced by focused regressions there; reuse those
implementations as reference patterns instead of inventing variants.

## Mandatory baseline for every first-party MCP

### 1. Ingress identity (the MCP server)

- **JWT-only.** Every protected request presents `Authorization: Bearer <signed
  MCP assertion>` — an RS256 token signed by the backend, verified offline with
  the connector-configured public key (`MCP_JWT_PUBLIC_KEY_FILE`), expected
  issuer (`MCP_JWT_ISSUER=yellowstorm`) and the MCP's own audience
  (`MCP_JWT_AUDIENCE`, e.g. `mcp-pyodide`), with integer `iat`/`exp` and
  lifetime ≤ 300 seconds.
- **Fail closed.** Missing, malformed, expired, wrong-issuer, wrong-audience or
  invalid-signature assertions get 401 before any MCP runtime work. A legacy
  static header (`x-*-mcp-token`, `X-Internal-Token` at MCP surfaces) is denied
  on every route, including `/health/*` short-circuit ordering.
- **No static credentials.** No shared bearer tokens, API keys or generic
  ingress secrets for first-party MCPs — neither as env fallback nor default.
- **Identity from signature only.** The acting user is the verified `sub`
  (backend mints 24-hex ObjectId user ids; validate accordingly). Caller
  headers (`X-YellowStorm-User-Id`, `X-YellowStorm-Agent-Id`) are never
  identity: a user header that disagrees with `sub` is rejected; agent and
  conversation headers are tracing only, never authority.
- **Unambiguous headers.** Duplicate, array-valued or comma-joined security
  headers (authorization, assertion, user, correlation, …) are rejected before
  verification.
- **Health.** `/health/live` (and `/health/ready`, which validates settings)
  stay public and reveal nothing; everything else is gated.

### 2. Request-local context and isolation

- Actor, correlation and any binding context (workspace, input files) live in
  **ContextVars** installed by the ingress middleware and restored in `finally`
  with stacked semantics (`reset_contextvars(**bound)`), surviving success,
  rejection, exceptions and `CancelledError`.
- **Everything that can raise runs before the first ContextVar mutation** (for
  example JSON parsing of binding headers), so a parser failure cannot leave a
  half-installed identity behind the cleanup boundary.
- Logging binds verified identity (user/agent/conversation/correlation) inside
  the same try/finally; logging-setup failure must not leak context either.

### 3. Transport and deployment shape

- Stateless **Streamable HTTP** (`stateless_http=True`) on `/mcp`; no
  server-managed MCP sessions. Stdio is for development only.
- Configuration is minimal and uniform: `YELLOWSTORM_BACKEND_URL`,
  `MCP_JWT_PUBLIC_KEY_FILE`, `MCP_JWT_ISSUER`, `MCP_JWT_AUDIENCE`, host/port,
  plus genuinely per-feature knobs. No per-server duplicates of shared auth
  settings; retired env keys must be deleted, not ignored.
- Default consolidation: a new first-party capability ships as a **tool module
  of mcp/mcp-platform** (ADR-0035) unless it needs its own runtime/dependencies
  (browser relay, own database, external network egress), in which case it is a
  separate deployment with its own audience — same baseline either way.

### 4. Egress (MCP → backend)

- The client forwards the **verified assertion** as `X-YellowStorm-Mcp-Assertion`
  plus a correlation id, and optionally tracing context. It never sends static
  tokens (`X-Internal-Token`) or an unverified user header.
- The forwarded assertion is a **bearer capability**, not workload identity: its
  use is bounded by the verified connector/audience and the actor's permissions.
  This deliberately replaces mTLS-style machine credentials without claiming them.
- Fail closed when no verified assertion exists in context; response size caps,
  timeouts and bounded error mapping (stable per-module error codes) are
  mandatory. A receiver that is absent must surface as a clean tool error, not a
  crash.

### 5. Backend receiver side (internal controller)

- `DelegatedActorGuard` plus a code-declared `@McpRouteAudience(...)` fence;
  the service principal for audit comes from the **verified token audience**
  (`ROUTE_PRINCIPALS`), never from a caller-selected header.
- Connector policy checks stay authoritative: profile `internal_jwt`, current
  `security_revision`, `verified_user` delegation, `allowInsecureHttp=false`.
- Domain authorization (workspace/resource ownership, permissions, model
  access) stays in the owning backend service; MCP surface never bypasses it.
- Migration audiences are additive only (legacy + new until retirement) and each
  list collapses back to one entry after old deployments retire.

### 6. Bounds and tool contract

- Every tool enforces explicit limits (payload/code size, timeout ceilings,
  file counts, queue depth) and rejects storage paths — logical names only.
- Tool names, inputs/outputs, envelopes and error codes are stable public
  contract; per-module prefixes keep them namespaced. No generic
  "call any backend endpoint" tool.

### 7. Required verification (definition of done)

- Focused suites with **real RSA verification** (not a mocked verifier):
  valid / missing / garbage / expired / wrong-issuer / wrong-audience /
  foreign-key assertions; duplicate-header and identity-spoof rejection;
  legacy-header denial; health bypass.
- Isolation regressions: nested-context restore across success/reject/error/
  cancel, parser-failure restoration, production-entrypoint test asserting
  stateless HTTP + middleware wiring, and (where applicable) a live HTTP gate
  matrix (401 negatives, stateless initialize, one real tool call).
- Backend boundary: the shared controller-security integration matrix must
  cover the new audience with foreign-audience rejection.
- Required security review for any new MCP or auth change; deployment pairs
  server + receiver + connector-row migration in one coordinated window
  (connector profile `internal_jwt`, audience, `verified_user`,
  `streamable_http`, URL path `/mcp`).

## Notes on adjacent records

- Logical Search keeps ADR-0031/0032's offline signed workspace scope on top of
  this baseline (bounded subset, TTL ≤ 300s, size caps) with no backend
  authorization callback.
- Other internal services (Root/ADK renewal, app runtime, semantic runtime,
  artifact operations) keep their existing scoped machine credentials — do not
  remove those when deleting retired MCP secrets.
- ADR-0035 records the platform-MCP consolidation and migration/retirement
  procedure; ADR-0017/0018 remain the underlying policy framework.
