---
id: ADR-0023
status: accepted
scope: mcp-static-credential-ingress-with-user-attribution
source_paths:
  - YellowStorm/back/src/modules/connector/services/mcp-jwt.service.ts
  - YellowStorm/back/src/modules/connector/utils/mcp-security-policy.ts
  - YellowStorm/back/src/modules/connector/connector.service.ts
  - yellowstorm-adk/src/mcp/jwt_auth.py
  - mcp/mcp-semantic-model/auth.py
  - mcp/mcp-semantic-model/server.py
  - YellowStorm/front/src/modules/admin/pages/connectors/CreateEditConnectorDialog.tsx
proposed_at: 2026-10-17
accepted_at: 2026-10-17
---

# Two-header assertion authentication for static-credential MCP ingress

## Status and scope

Accepted. The user confirmed this named design on 2026-10-17 ("ADR-0023
approval"), extending — not superseding — [ADR-0017](ADR-0017-mcp-security-and-authentication-baseline.md)
and [ADR-0018](ADR-0018-connector-managed-mcp-security.md). Acceptance enables
implementation; deployment certification and the verification gates below remain
separate. Nothing here was implemented at acceptance time; current behavior is
the verified gap below.

Scope: connectors that authenticate with a connector-managed static credential
(Saved credential / `configured` profile) whose receiving MCP needs verified
user attribution for some operations. Out of scope: `internal_jwt` connectors
(already C1), `public` connectors, connected-app OAuth ingress, and new
services/tables/runtimes.

## Context and verified gap

The Connector UI's four auth methods (ADR-0018 editor contract) leave static
credentials without user identity. ADR-0018 permits `actorDelegation:
verified_user` only with `internal_jwt`. Verified live this session
(2026-10-17, ephemeral loopback MCPs):

- Static Bearer ingress: discovery succeeds; user-attributed tool calls fail
  closed with `ERR_1112` (missing semantic MCP actor assertion). Expected.
- The mcp-semantic-model server's Bearer mode documents that a shared ingress
  secret is not a signed user identity and a user-ID header is not actor proof.
- Forcing C1 JWT everywhere loses simple service-account deployments and forces
  signing-key provisioning on every MCP; a caller-supplied user-ID header is
  spoofable and rejected by ADR-0017 §2.

## Decision (proposed)

Compose two headers on each request from backend/ADK to the MCP:

1. `Authorization: Bearer <credential>` — the existing connector-managed static
   credential (ADR-0017 §C API-key rules: documented ownership, rotation,
   revocation; verifier-side secure storage). It authenticates the transport
   and service principal exactly as today.
2. `X-YellowStorm-Mcp-Assertion` — an optional, short-lived RS256 user
   assertion with C1-grade claims (`iss`, MCP-specific `aud`, `sub` from the
   validated execution identity, `iat`/`exp` with `0 < exp - iat <= 300`,
   connector ID and `securityRevision` bindings). Issued only when the
   connector policy resolves `actorDelegation: verified_user`, the destination
   is validated, and account/permission checks pass, using the existing
   `McpJwtService` and the existing scoped
   `ADK_RUNTIME_MCP_RENEWAL_TOKEN` assertion-proof renewal contract. No new
   token type, key or issuer is introduced.

Receiver contract (opt-in per MCP, documented in each server README):

- Verify the bearer credential always. Verify the assertion when present with
  the same strictness as C1 (algorithm, issuer, audience, lifetime, connector
  and revision binding); reject wrong-audience/stale-revision assertions.
- Absence of the assertion is not an error: unattributed (service) operations
  proceed; user-attributed operations (actor guards) fail closed with the
  existing error path. Presence of an invalid assertion is always an error.
- The assertion never relaxes the bearer check and never substitutes for
  per-tool resource authorization.

Connector policy contract: permit `actorDelegation: verified_user` on the
`configured` profile only when the server advertises assertion support.
Advertisement is configuration on the receiving side (e.g. server env), never
server-returned metadata trusted by the backend. The existing editor method
"Saved credential" gains a delegation summary under authorized security
details; no new auth method is added. Reserved-header protection already
blocks clients from injecting `X-YellowStorm-Mcp-Assertion` via custom
headers; extend that guard to the new header name explicitly.

## Alternatives considered

- **C1 JWT everywhere**: rejected — forces key provisioning and JWT client
  behavior on simple service MCPs; loses the plain-credential deployment model.
- **Bearer plus caller-supplied user ID**: rejected — spoofable; ADR-0017 §2
  and the semantic-model README already reject it.
- **Second JWT-only profile per connector**: rejected — duplicates C1 and the
  assertion binding machinery for marginal clarity.

## Constraints carried from governing records

- ADR-0017: five-minute maximum, no static-secret or identity-header fallback,
  authenticate before dispatch, fail closed; §C API-key rules for the bearer
  credential. The C1 claim/lifetime rules apply verbatim to the assertion.
- ADR-0018: policy/revision ownership, `connectors.security.manage` privilege
  for delegation changes, destination validation before issuance, renewal via
  assertion proof (no user-ID fallback), no new service/table/runtime, both
  ends of trust must match (UI selection does not configure a remote verifier).
- No secrets in connector metadata or policy; keys remain deployment-managed.

## Verification and acceptance (before promotion to accepted)

- Backend: issuance only for validated `configured`+`verified_user`+
  assertion-capable destinations; audience/revision binding claims; reserved
  header guard covers the assertion name; focused unit tests.
- Receiver: positive discovery with bearer only; user-attributed call succeeds
  with both headers; invalid/expired/wrong-audience assertion rejected;
  unattributed operations unaffected. Regression for replay across revisions.
- Renewal: existing scoped-principal + assertion-proof path issues a fresh
  assertion mid-flight; expired assertions require rebootstrap.
- UI: delegation summary visibility restricted by `connectors.security.manage`;
  EN/FR copy; editor tests. Frontend QA on the real connector.
- Required high-risk review (auth boundary) before implementation merges.

## Rollout

If approved: implement receiver support in one pilot MCP (semantic model) and
backend/ADK issuance behind the existing policy resolution; then expose the
delegation toggle for `configured` connectors in the editor. Servers without
assertion support keep bearer-only behavior. Rollback is removal of the
toggle plus server env; the bearer channel alone remains functional, so no
availability cliff exists.
