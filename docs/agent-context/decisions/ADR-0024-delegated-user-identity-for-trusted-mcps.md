---
id: ADR-0024
status: accepted
scope: delegated-user-identity-for-platform-trusted-mcps
source_paths:
  - YellowStorm/back/src/modules/auth/guards/delegated-actor.guard.ts
  - YellowStorm/back/src/modules/connector/services/mcp-jwt.service.ts
  - YellowStorm/back/src/modules/semantic-model/guards/semantic-assistant-model.guard.ts
  - YellowStorm/back/src/modules/semantic-model/controllers/semantic-model-assistant-internal.controller.ts
  - YellowStorm/back/src/modules/auth/guards/internal-service-principal.guard.ts
  - YellowStorm/back/src/modules/semantic-model/services/semantic-model-assistant.service.ts
  - mcp/mcp-semantic-model/auth.py
  - mcp/mcp-semantic-model/clients/yellowstorm_semantic_model_client.py
  - yellowstorm-adk/src/mcp/jwt_auth.py
proposed_at: 2026-10-17
accepted_at: 2026-10-17
---

# Delegated-user identity for platform-trusted MCPs

## Status and scope

Accepted. The user confirmed this named design on 2026-10-17 ("accepted!").
This record extends — and, for the trust class below only, relaxes part of —
[ADR-0018](ADR-0018-connector-managed-mcp-security.md). It does not change
[ADR-0023](ADR-0023-mcp-two-header-assertion-auth.md). Acceptance enables
implementation; the verification gates below still apply to each migrated
surface, and deployment certification remains separate.

Scope: the **platform-trusted MCP trust class** — first-party MCP servers
developed, deployed and versioned alongside this platform that serve AI agents
invoked by an authenticated platform user (semantic model, playbook, and future
first-party MCPs). Out of scope: third-party or administratively configured
connectors, connected-app OAuth ingress, and any new service, table or runtime.

## Context and verified gap

Today every MCP-backed backend domain repeats the same actor-guard code. The
existing `SemanticAssistantActorGuard` — the pre-change owner this record
retires — shows the pattern: verify the
backend-signed assertion (`McpJwtService.verifyMcpAssertion`) against a
**per-route expected audience**, pin `x-yellowstorm-user-id` to the verified
`sub`, load the user's roles/permissions into `request.user`, and fail closed
in JWT mode when no assertion is present. A new MCP requiring user-scoped
authorization must re-implement all of it, and each internal route must declare
which MCP audience may call it.

Verified in this session:

- The security-critical property is already enforced: the actor is derived only
  from a backend-signed assertion (never a caller-supplied user-ID header), and
  resources are scoped by that verified user (`models.list(userId)`,
  `models.get(userId, modelId)`, owner-only delete).
- ADR-0018 §"Runtime policy and token lifecycle" additionally requires the
  actor guard to check "its trusted expected audience", and §5 requires expected
  audiences passed from trusted policy to generic verification.
- That audience binding is the only genuinely per-integration part of the guard;
  everything else (signature/lifetime/connector/revision checks, user + permission
  hydration, fail-closed behavior) is generic.
- In practice a first-party MCP may legitimately need a route in another domain
  (for example the semantic-model MCP calling a playbook-scope endpoint), which a
  strict per-route audience fence would deny for no security benefit.

## Decision (proposed)

1. **One trust class, one delegated credential.** A backend-signed, short-lived
   assertion (`McpJwtService`, RS256, `0 < exp - iat <= 300`, issuer, `sub` from
   the validated execution identity, connector ID + `securityRevision` binding)
   is a **delegated-user credential** for platform-trusted MCPs. It is not
   scoped to a single backend route.

2. **Recognized once, generically.** Teach the existing authentication layer to
   accept this credential type on the internal MCP surface, exactly as it accepts
   a user session token: verify the signature and lifetime rules, then hydrate
   `request.user` with the actor from `sub` and that actor's permissions. No
   per-MCP actor guard is written again; a domain declares itself an internal MCP
   surface once, not once per integration.

   This **retires** `SemanticAssistantActorGuard` rather than wrapping it: the
   class and its spec are deleted, and its call sites drop it. What remains in
   that area is genuinely domain-specific and is kept: `SemanticAssistantModelGuard`
   (turns a model name into a user-scoped id), the `assistantActorFrom` routing
   helper, and the scoped service-principal guard that proves the caller is a
   trusted MCP at all. Only identity verification moves into the shared layer.

3. **No per-route audience fence for this class.** Any platform-trusted MCP may
   call any internal MCP route on behalf of the invoking user; cross-scope calls
   are permitted, not forbidden. The audience claim is retained in the token as
   a non-enforced attribute and as the future escape hatch (see 7).

4. **The permission ceiling is always the invoking user's.** Actor delegation
   grants no additional authority: every call runs with the verified user's
   account state, roles and permissions, and existing per-domain resource rules
   (ownership, owner-only operations, sharing) continue unchanged. This is the
   invariant that must never weaken.

5. **Fail closed; no header substitution.** On the internal MCP surface the
   assertion is required in JWT mode; an absent assertion is a rejection, a naked
   user-ID header is never an identity source, and a header that disagrees with
   the signed `sub` is rejected. Session ID or any other transport-derived value
   must never select an actor (ADR-0018 P0 isolation remains in force).

6. **Attribute and audit cross-scope use.** Every delegated call records the
   verified actor, the calling service principal (which MCP), and the
   agent/conversation correlation id. Cross-scope calls are allowed *and visible*;
   auditability replaces the audience fence as the practical control.

7. **Cheap escape hatch, not a fence.** The connector/revision binding stays
   (policy changes invalidate issued assertions). If an incident ever requires
   narrowing blast radius, an optional per-server allowlist can be added later
   without redesign; it is not built now because the user judged it too
   restrictive for a co-deployed, first-party trust class.

## Consequences

Accepted trade-off: dropping audience binding trades **blast-radius containment
and intent-scoping** for simplicity and uniformity. If one trusted MCP is ever
compromised or defective, it could exercise any operation the *currently active
user* is permitted to perform, for the assertion's remaining lifetime (≤5
minutes). Mitigations: short TTL, revision binding, full attribution/audit, and
the deployment perimeter control (loopback/TLS, scoped service principals,
version-locked co-deployment). The user accepted this residual risk explicitly.

This decision holds only while every MCP in the class remains first-party,
co-deployed and version-locked with the backend. A connector that leaves that
class falls back to ADR-0017/ADR-0018 audience-bound verification.

## Relationship to governing records

- **ADR-0017** (MCP security baseline): unchanged. It still governs transport,
  deployment profiles, C1 claim/lifetime rules and the rejection of identity
  headers as proof; this record reuses them.
- **ADR-0018** (connector-managed security): remains authoritative. Specifically
  relaxed **only** for the platform-trusted class: the per-route "trusted
  expected audience" requirement (§"Runtime policy and token lifecycle") and the
  per-integration expected-audience plumbing (§5). Policy/revision ownership,
  `connectors.security.manage`, privileged write protection, destination
  validation, renewal-by-assertion-proof and the no-user-ID-fallback rule all
  remain binding.
- **ADR-0023** (two-header assertion auth): unaffected and compatible. Its
  forwarded assertion on static-credential connectors is the same delegated
  credential and gains the same generic handling once this record is accepted.
- No new service, table, namespace or runtime. The change is confined to the
  existing auth layer, the existing connector issuer and the existing internal
  routes.

## Alternatives considered

- **One actor guard per MCP (status quo)**: rejected — duplicated security code
  that drifts; the user asked for the generic mechanism instead.
- **Keep per-route audience binding**: rejected by the user as too restrictive
  for trusted, co-deployed MCPs and unable to serve legitimate cross-domain calls.
- **Caller-supplied user-ID header**: rejected — spoofable; already rejected by
  ADR-0017 §2 and the semantic-model README. Not revisited here.
- **Gateway-issued internal impersonation tokens**: rejected — re-introduces a
  second trust hop and a new credential-minting component for no gain over
  verifying the existing signed assertion in the auth layer.

## Verification and acceptance

- Forged, expired, wrong-issuer or stale-revision assertions are rejected on every
  internal MCP route; a naked user-ID header is never honored.
- Missing assertion on the internal MCP surface fails closed in JWT mode.
- A delegated call can never exceed the invoking user's permissions, including
  cross-scope calls; unauthorized actors are denied by existing domain rules.
- Concurrent Alice/Bob requests (and renewal mid-flight) never substitute actors;
  the existing isolation regressions must still pass.
- Cross-scope calls are attributed in logs/audit with actor, calling principal and
  correlation id.
- Regression: the semantic-model flow keeps passing with the generic mechanism
  replacing `SemanticAssistantActorGuard`; the guard has no remaining references
  in source, tests or module providers once migrated; no behavior change for
  `internal_jwt` connectors.
- Required high-risk review (authentication boundary) before implementation merges.

## Rollout

Implementation order if approved: (1) introduce the credential type in the
existing auth layer with one internal-surface declaration; (2) migrate the
semantic-model routes onto it and **delete `SemanticAssistantActorGuard` and its
spec** (keeping the model-name resolution guard and routing helper); (3) remove
duplicated per-MCP actor guards as each domain migrates; (4) keep the audience
claim and revision binding in issued tokens throughout. Rollback restores the
deleted per-domain guards by reverting the migration commit; that is possible for
as long as the assertion contract is unchanged.

## Implementation status (2026-10-17)

Delivered in the semantic-model migration:

- `modules/auth/guards/delegated-actor.guard.ts` — the single shared guard. It
  requires the assertion (fail closed, no naked user-id header and no developer
  Bearer fallback), derives the actor only from `verifyDelegatedActor`, rejects a
  header that disagrees with the signed actor, pins the verified id and loads that
  user's account state, roles and permissions. No per-route audience argument.
- Attribution (§6) is implemented in the same guard: every accepted delegated call
  is written to the existing audit log (`mcp.delegated_call`) with the verified
  actor, the authenticated calling principal, the correlation id and the matched
  route/method — fire-and-forget and secret-free (no credential, assertion or raw
  URL with query parameters). Calls this guard rejects are not attributed; a call
  that authenticates here and is then denied by a later guard (e.g.
  `PermissionsGuard`) IS attributed, since the record means "delegated
  authentication succeeded", not "the operation succeeded".
- `McpJwtService.verifyDelegatedActor` — same signature/lifetime/connector/
  revision authority as `verifyMcpAssertion` without the audience fence, sharing
  one private verifier. `verifyMcpAssertion` (audience-bound) is unchanged and
  still used by renewal, inspection and runtime binding.
- Deleted: `semantic-model/guards/semantic-assistant-actor.guard.ts` and its spec.
  Kept: `SemanticAssistantModelGuard` + `assistantActorFrom`, moved to
  `semantic-model/guards/semantic-assistant-model.guard.ts`.
- `SemanticModelAssistantInternalController` now uses
  `SemanticMcpServiceGuard, DelegatedActorGuard, PermissionsGuard,
  SemanticAssistantModelGuard`; the module provides the shared guard.
- Verified: focused suites for the guard and `McpJwtService` (36 tests) plus the
  connector and semantic-assistant suites (130 tests) pass; `tsconfig.build.json`
  type-check passes.

Not yet migrated (still on a naked `x-yellowstorm-user-id` header, therefore a
separate increment that must change both the backend header producers in
`agent.service.ts`/`evaluation.service.ts` and the `mcp-playbook`/`mcp-agent`/
`mcp-team` servers to forward the assertion before their guards can be deleted):
`PlaybookAssistantActorGuard` and `AgentCrudActorGuard`. Until then those
surfaces are outside this record's guarantee.

Retained deliberately for now, no longer read by the backend guard:
`SEMANTIC_MODEL_MCP_AUTH_MODE` / `SEMANTIC_MODEL_MCP_JWT_AUDIENCE` remain in the
config schema as the mirror of the receiving MCP server's ingress mode and its
production-must-be-JWT validation contract.
