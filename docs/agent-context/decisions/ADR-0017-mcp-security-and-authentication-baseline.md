---
id: ADR-0017
status: accepted
scope: mcp-security-and-authentication
source_paths:
  - docs/agent-context/architecture/change-control.md
  - docs/observability/logging-contract.md
reviewed_at: 2026-10-16
---

# MCP security and authentication contract

## Context and scope

This decision establishes the required security contract for new MCP servers and security changes
to existing MCPs. The user's request in this conversation authorizes this
documentation decision. It does not attest that every existing MCP complies,
approve a new service or authorize deployment. No prior ADR is superseded;
[architecture change control](../architecture/change-control.md) applies.

The requirements below are normative and independent of any existing MCP's
implementation. No existing MCP is designated as a compliant baseline or template.

## Decision

### 1. Authenticate before MCP dispatch; fail closed

- Protect every HTTP MCP entry point, including initialization, discovery,
  tool/resource/prompt calls and SSE/streamable-HTTP session requests. A session
  identifier is not an authentication credential; bind sessions to their actor
  and reject reuse by another actor.
- For YellowStorm-managed production MCPs, use backend-issued RS256 JWTs with a
  dedicated RSA signing key (at least 2048 bits). Only the issuer holds the private
  key; MCPs receive the public verification key.
- Fix the permitted algorithm, configured issuer and MCP-specific audience.
  Require and validate `sub`, `iss`, `aud`, `iat`, `exp`; reject expired,
  future-issued, malformed, incorrectly signed or overlong tokens. Require
  `0 < exp - iat <= 300` seconds; validate `nbf` when present. Never derive trusted
  keys, algorithms or issuers from unverified request data.
- Accept exactly one well-formed Authorization bearer header; reject ambiguous
  or duplicate credentials. Missing/invalid credentials produce HTTP 401 before
  tool execution or downstream access. Authenticated but forbidden operations
  produce 403 using the transport's established error contract.
- Missing keys/issuer/audience or an unsafe production auth mode must fail
  startup. JWT validation failure must never fall back to a static secret,
  Graph token, client identity header or anonymous execution.
- A gateway may add authentication, but cannot leave a reachable bypass to an
  unauthenticated MCP listener. A gateway-terminated alternative requires a
  documented authenticated gateway-to-service boundary and bypass tests.
  Network placement and CORS alone are not authentication.
- Public routes are explicit, minimal health checks or required auth metadata;
  they expose neither tools nor secrets. Shared Bearer mode is a development-only
  compatibility path, explicitly configured, constant-time checked and rejected
  in production. Production integrations outside the managed JWT model require
  a documented, approved auth design rather than a silent fallback.
- For local stdio, document the process/user trust boundary and secret injection;
  do not expose that trust model unchanged over an HTTP listener.

### 2. Authorize the verified actor, not supplied headers

- Derive the acting user from validated `sub`. Ignore untrusted identity headers
  as authority and reject disagreement with a claimed actor. Agent, conversation,
  run and correlation headers are trace data unless separately bound and checked.
- Authentication does not grant all tools. Check current user/account access,
  permissions and resource ownership before reads or writes. Define an explicit
  per-tool authorization mapping; validate scopes/roles when that is the chosen
  policy. A token carrying only `sub` does not prove a tool scope.
- Keep backend resource checks authoritative when tools delegate to YellowStorm.
  Authenticate the calling service with its scoped principal credential and
  verify a signed user assertion separately; a service secret plus a naked
  user-id header is insufficient for production impersonation.
- Derive storage namespaces from verified tenant/user identity and server-owned
  run identifiers. Check run/object ownership before sending or reading files;
  sanitizing a path or validating an identifier's syntax does not prove ownership.
- Keep request identity/assertions isolated and restore context in `finally`,
  including failures and cancellations. Test sequential and concurrent callers.

### 3. Separate ingress credentials from downstream credentials

- The ingress JWT authorizes access to this MCP (its audience), not Microsoft
  Graph or another provider. Do not forward it as a provider access token or
  accept a Graph-audience token as the MCP credential.
- Resolve downstream OAuth credentials server-side for the verified actor and
  authorized connector/account, or use an explicitly authorized application
  identity with bounded tenant/resource access. Never select credentials from
  an unverified user/run header or fall back to a global token on missing auth.
- Use least-privilege provider permissions and tenant/site/resource allowlists.
  Separate read/write capabilities when warranted; destructive operations need
  server-enforced authorization and the product's explicit approval policy.
  MCP annotations and model instructions are not enforcement.
- Give each service only its required internal principal permissions. Keep
  signing keys, ingress credentials, internal service secrets and provider tokens
  distinct; provision and rotate them through deployment secret management.

### 4. Bound the remaining trust boundaries

- Use TLS at ingress and restrict listener reachability to intended callers.
  A container may bind `0.0.0.0` inside an isolated network; host exposure must be
  deliberate and protected. Use explicit CORS origins/methods/headers when browser
  access is required; disable unnecessary browser access.
- Validate destinations against an explicit egress policy before resolving or
  attaching credentials, and enforce deployment network rules. Deny unsafe
  schemes, destinations and redirects; do not create broad private-network
  exceptions. Any internal-service exception must be explicitly approved, limited
  to an exact endpoint and protected by authenticated service access.
- Bound input sizes, concurrency, timeouts and actual streamed download bytes;
  metadata or Content-Length alone is not a memory limit. Abort oversized bodies.
- Return stable public errors; keep redacted diagnostics and actor/action/outcome
  audit events server-side. Never log Authorization, signed assertions, provider
  tokens, secrets or signed download URLs. Follow the
  [logging contract](../../observability/logging-contract.md).
- Pin deployment dependencies reproducibly, scan them in CI, run as non-root,
  and verify healthcheck port/path against the actual transport configuration.

## Reference implementation status

There is currently no designated reference implementation. Existing servers must
be assessed against this contract; their presence in the repository is not evidence
of compliance. Agents must not copy a sibling MCP's authentication, configuration
defaults or credential handling as an approved security baseline.

`mcp/mcp-semantic-model` is a candidate for a future reference implementation,
including its issuer, caller and downstream authorization chain. This is a possible
follow-up, not a designation or a claim that it already satisfies the contract.

Before designating any reference:

1. Map every applicable requirement to owned source, configuration and tests;
   explain genuinely inapplicable requirements and record remaining gaps.
2. Close the gaps and run the verification gate below, including cross-boundary
   checks, request-context cleanup and deployed ingress controls.
3. Complete the required security review and publish the reviewed revision,
   verification evidence and reusable component boundaries in a separate record.
4. Explicitly approve its reference status before linking it as a template for
   new MCPs. Any unresolved requirement remains a gap, not an inherited exception.

## Implementation and verification gate for agents

Before implementation, record the MCP's issuer/audience, actor and service
identities, downstream credential owner, tool permission mapping, public routes
and deployment boundary in its owning README/context. Obtain approval for new
boundaries under change control. Assess existing components against this contract
before reuse; reuse requires evidence for the relevant controls, not similarity
to another MCP. Record and resolve gaps instead of inheriting unsafe behavior.

Required evidence for an auth/security change:

1. Missing/malformed/duplicate credentials, wrong signature/algorithm/issuer/
   audience, expired/future/missing claims and excessive lifetime deny execution;
   prove no tool, provider or storage side effects occurred.
2. Valid authorized requests succeed; insufficient permissions, cross-user/
   cross-tenant resources, actor-header spoofing and session/run substitution fail.
3. Verify both sides of issuance/renewal and downstream actor assertions. A token
   for one MCP cannot authenticate to another; Graph and MCP credentials cannot
   substitute for one another. Production config rejects fallback modes.
4. Verify concurrent/sequential identity isolation and failure cleanup; confirm
   public health routes, gateway bypass protection and redacted errors/logs.
5. Run affected integration checks and the required high-risk reviewer under
   repository instructions. Document actual PASS/FAIL/BLOCKED results and gaps;
   unit tests or this record alone do not prove deployed security.

## Rationale and consequences

Separating caller authentication, user authorization and provider credentials
prevents the SharePoint audit's missing ingress gate from exposing ambient tenant
authority. A consistent managed JWT contract reduces divergent security mechanisms,
while explicit audience registration prevents credential reuse across MCPs.
The cost is key/credential lifecycle management, token renewal, permission mapping
and boundary tests. A shared auth package is not introduced by this decision.

## Verification of this record

The initial draft was informed by source and existing test inspection at
`99389a934` on `security/p0p1-remediation`. The user clarified that the contract
must remain generic and existing MCPs must not be treated as reference baselines;
this record reflects that clarification. Documentation-only change: no production
code or deployment was changed, and no runtime/security test was executed or
reference implementation certified for this ADR.
