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

This decision establishes the required security contract for new MCP servers and
security changes to existing MCPs. The user's request in this conversation
authorizes this documentation decision. It does not attest that every existing MCP complies,
approve a new service or authorize deployment. No prior ADR is superseded;
[architecture change control](../architecture/change-control.md) applies.

The requirements below are normative and independent of any existing MCP's
implementation. No existing MCP is designated as a compliant baseline or template.

## Decision: universal requirements

JWT is not universally required. JWT is a token format; OAuth is an authorization
framework whose access tokens can be JWTs or opaque tokens. Choose and document
the applicable authentication profile below. Requirements mentioning token claims
apply only to profiles using those claims; equivalent verified identity and
authorization are required for other authenticated profiles.

### 1. Authenticate before MCP dispatch; fail closed

- For protected HTTP MCPs, authenticate every MCP entry point, including
  initialization, discovery,
  tool/resource/prompt calls and SSE/streamable-HTTP session requests. A session
  identifier is not an authentication credential; bind sessions to their actor
  and reject reuse by another actor.
- Validate credentials using the selected profile's trusted verifier, validity
  rules, intended recipient and permissions. Never derive trust from unverified
  request data. An API key proves only its registered client, and mTLS proves
  only the authenticated workload; neither automatically identifies a human user.
- Reject ambiguous or duplicate credentials. For bearer-token profiles, accept
  exactly one well-formed Authorization bearer header on every HTTP request;
  never put access tokens in URLs. For HTTP-layer authentication, missing/invalid
  credentials produce HTTP 401 before
  tool execution or downstream access. Authenticated but forbidden operations
  produce 403 using the transport's established error contract.
- Missing profile-required trust configuration or an unsafe production auth mode
  must fail startup. Authentication failure must never fall back to a static secret,
  Graph token, client identity header or anonymous execution.
- A gateway may add authentication, but cannot leave a reachable bypass to an
  unauthenticated MCP listener. A gateway-terminated alternative requires a
  documented authenticated gateway-to-service boundary and bypass tests.
  Network placement and CORS alone are not authentication.
- Public routes are explicitly declared health checks, required auth metadata or
  capabilities approved under the anonymous public profile. They expose no private
  data or privileged operations. Development-only modes must be rejected in
  production; changing profile is a documented design choice, never a fallback.
- For local stdio, document the process/user trust boundary and secret injection;
  do not expose that trust model unchanged over an HTTP listener.

### 2. Authorize the verified actor, not supplied headers

- Derive the actor from verified credentials or the documented local process
  identity; use validated `sub` where the chosen token profile defines it.
  Ignore untrusted identity headers as authority and reject disagreement with a
  claimed actor. Agent, conversation,
  run and correlation headers are trace data unless separately bound and checked.
- Authentication does not grant all tools. Check current user/account access,
  permissions and resource ownership before reads or writes. Define an explicit
  per-tool authorization mapping; validate scopes/roles when that is the chosen
  policy. A verified identity alone does not prove a tool permission.
- Keep backend resource checks authoritative when tools delegate to YellowStorm.
  Authenticate the calling service and separately verify user delegation through
  an audience-bound assertion or equivalent trusted delegation mechanism;
  a service secret plus a naked user-id header is insufficient for production
  impersonation.
- Derive storage namespaces from verified tenant/user identity and server-owned
  run identifiers. Check run/object ownership before sending or reading files;
  sanitizing a path or validating an identifier's syntax does not prove ownership.
- Keep request identity/assertions isolated and restore context in `finally`,
  including failures and cancellations. Test sequential and concurrent callers.

### 3. Separate ingress credentials from downstream credentials

- An ingress credential authorizes access to this MCP, not Microsoft Graph or
  another provider. Do not pass an inbound MCP access token through to an upstream
  API or accept a provider-only token as the MCP credential. Provider tokens must
  be separately issued for the upstream resource.
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

- Use TLS for production HTTP ingress and restrict listener reachability to
  intended callers.
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

## Authentication profiles and selection

Select by transport, caller and authority: local process (A), development HTTP
(B), private workload (C), interactive remote client (D), unattended job (E), or
intentionally public capability (G). Gateway deployment (F) composes with the
relevant caller profile. Record whether operations act as a user or an application;
the ingress profile does not determine the provider's credential type.

### A. Local stdio

- Use the OS user/process boundary and a trusted launcher. No separate HTTP JWT
  gate is required. Inject provider credentials through the environment or a
  secret manager; restrict process, filesystem and inherited secret access.
- Treat tool execution as local code execution with that process's privileges.
  Do not promote this trust model to remotely accessible HTTP unchanged.

### B. Development HTTP

- Bind to loopback, validate allowed hosts/origins and use an explicit development
  credential with constant-time verification. Loopback alone does not protect
  against browser-origin attacks; CORS is not authentication.
- Use limited test credentials/data. Fail startup if this development-only mode
  is selected in production; do not infer development mode from a failed login.

### C. Private backend-to-MCP or runtime-to-MCP

- Prefer managed workload identity, mTLS or short-lived service access tokens.
  Map the authenticated workload to an explicit tool/resource policy. Private
  networking is defense in depth, not proof of caller identity.
- If acting for a person, verify bounded user delegation as well as the workload's
  authority to delegate. A service identity must not choose an arbitrary user.
- A per-client API key can be used for a bounded controlled integration when its
  ownership, revocation, rotation, storage and permissions are documented. Store
  only a verifier/hash where feasible and verify securely. Do not use one shared
  key plus caller-supplied user IDs as multi-user authentication.
- Custom workload/API-key profiles require compatible clients; they do not by
  themselves implement MCP's OAuth discovery/authorization interoperability.

#### C1. YellowStorm internal JWT profile

When this profile is selected, use backend-issued RS256 JWTs signed with a
dedicated RSA key of at least 2048 bits. Only the issuer holds the private key;
verifiers receive trusted public keys. Fix the algorithm, issuer and MCP-specific
audience. Require valid `sub`, `iss`, `aud`, `iat`, `exp`, with
`0 < exp - iat <= 300` seconds; validate `nbf` when present. Reject wrong signatures,
expired/future-issued tokens and malformed claims. Define renewal, key rotation
and revocation/account-access policy. No static-secret or identity-header fallback
is allowed. These algorithm/claim/lifetime choices are specific to C1, not universal
requirements for OAuth, mTLS, stdio or other profiles.

### D. Interactive remote users and interoperable MCP clients

- Use MCP-compatible OAuth authorization with authorization code and PKCE, trusted
  authorization-server discovery and protected-resource metadata as required by
  the supported MCP version. Bind access tokens to the MCP resource and enforce
  scopes plus resource-level permissions; implement consent and renewal handling.
- Validate JWT access tokens with trusted keys and the issuer's token contract,
  or validate opaque tokens through the trusted authorization server's supported
  introspection mechanism. Reject inactive tokens and verify intended recipient,
  validity and granted permissions. Do not impose C1's RS256/300-second policy on
  an external provider's token contract or accept an ID token as an access token.

### E. Unattended automation

- Use an application/workload identity, commonly OAuth client credentials where
  the authorization server and MCP client support it. Prefer workload federation
  or certificate-based authentication over long-lived shared secrets where available.
- Authorize the application's jobs, tools and resources explicitly. Client
  credentials do not represent a logged-in user. If user delegation is required,
  select a supported delegated flow rather than fabricating a human identity.
- Validate resulting access tokens under the issuer's contract as in D; document
  client/extension compatibility instead of assuming all MCP clients support this flow.

### F. Gateway-terminated authentication

- Authenticate clients using the selected caller profile and prevent direct access
  to the MCP backend. Authenticate gateway-to-service traffic using mTLS/workload
  identity or a scoped assertion with an explicitly trusted verifier.
- Strip caller-supplied identity headers and inject only verified, authorized
  context. Bind actor/session context across the hop. Test direct-listener bypass,
  spoofed headers and forged gateway identity; gateway reachability alone is insufficient.

### G. Anonymous public access

- Allowed only for explicitly approved public capabilities: no private data,
  privileged writes or ambient tenant authority. Apply rate limits, quotas,
  concurrency/input/output limits and abuse monitoring even without caller identity.
- Keep protected capabilities behind an authenticated boundary. A public mode
  cannot become a fallback when protected authentication is absent or invalid.

### Provider authority is a separate choice

For connectors such as SharePoint, user-facing operations normally resolve the
verified user's authorized delegated provider connection. An explicitly authorized
background job may instead use a restricted application identity with site/resource
allowlists. Neither choice permits unauthenticated callers to inherit a global
provider token. Document this downstream authority independently of profiles A–G.

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

Before implementation, record the selected profile(s), trusted verifier and any
issuer/audience, actor and service identities, downstream credential owner,
tool permission mapping, public routes and deployment boundary in its owning
README/context. Obtain approval for new
boundaries under change control. Assess existing components against this contract
before reuse; reuse requires evidence for the relevant controls, not similarity
to another MCP. Record and resolve gaps instead of inheriting unsafe behavior.

Required evidence for an auth/security change:

1. For protected capabilities, prove invalid/missing/ambiguous credentials deny
   execution with no tool/provider/storage side effects. Apply profile-specific
   negatives: JWT claims/signatures and C1 lifetime, inactive opaque tokens,
   untrusted workload certificates or revoked API keys as applicable. For A/G,
   verify the declared process/public boundary rather than inventing a JWT gate.
2. Valid authorized requests succeed; insufficient permissions, cross-user/
   cross-tenant resources, actor-header spoofing and session/run substitution fail.
3. Verify both ends of issuance/renewal or workload authentication, credential
   rotation/revocation and delegated actor verification as applicable. Credentials
   must not cross their authorized recipient boundary; provider and MCP tokens
   cannot substitute for one another. Production config rejects development modes
   and authentication failures never switch profiles.
4. Verify concurrent/sequential identity isolation and failure cleanup; confirm
   public health routes, gateway bypass protection and redacted errors/logs.
5. Run affected integration checks and the required high-risk reviewer under
   repository instructions. Document actual PASS/FAIL/BLOCKED results and gaps;
   unit tests or this record alone do not prove deployed security.

## Rationale and consequences

Separating caller authentication, user authorization and provider credentials
prevents the SharePoint audit's missing ingress gate from exposing ambient tenant
authority. Scenario-specific profiles allow local, remote, interactive and workload
use without confusing a token format with the security contract. Recipient binding
prevents credentials being reused outside their authorized boundary. The cost is
profile-specific credential lifecycle management, permission mapping and boundary
tests. A shared auth package is not introduced by this decision.

## Protocol references

- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization):
  HTTP authorization framework, bearer-token handling and stdio distinction.
- [MCP authorization security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations):
  intended-recipient validation and prohibition of upstream token passthrough.

These protocol references do not prescribe C1 or prove support for every custom
profile in every client. Verify the actual SDK/client and supported protocol version
when implementing; follow current official guidance for external API details.

## Verification of this record

The initial draft was informed by source and existing test inspection at
`99389a934` on `security/p0p1-remediation`. The user clarified that the contract
must remain generic and existing MCPs must not be treated as reference baselines;
this record reflects that clarification and the subsequent approval to separate
generic requirements from explicit authentication profiles. Documentation-only
change: no production code or deployment was changed, and no runtime/security test was executed or
reference implementation certified for this ADR.
