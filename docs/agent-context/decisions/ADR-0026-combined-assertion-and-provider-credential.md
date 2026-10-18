---
id: ADR-0026
status: accepted
scope: combined-user-assertion-and-delegated-provider-credential-for-mcp-connectors
source_paths:
  - YellowStorm/back/src/modules/agent/services/agent-connector-runtime.service.ts
  - YellowStorm/back/src/modules/connector/connector.service.ts
  - YellowStorm/back/src/modules/connector/admin-connector.controller.ts
  - YellowStorm/back/src/modules/connector/connector-auth.service.ts
  - YellowStorm/back/src/modules/connector/utils/mcp-security-policy.ts
  - YellowStorm/front/src/modules/admin/pages/connectors/CreateEditConnectorDialog.tsx
  - mcp/mcp-sharepoint/auth.py
  - mcp/mcp-sharepoint/graph_helpers.py
  - mcp/mcp-sharepoint/README.md
proposed_at: 2026-10-18
accepted_at: 2026-10-18
---

# Combined user assertion and delegated provider credential for MCP connectors

## Status and scope

Accepted. The user confirmed this named design on 2026-10-18 ("approve as
designed"), including the request to widen the Microsoft connected app to
SharePoint write scopes. This record extends — and does not supersede —
[ADR-0017](ADR-0017-mcp-security-and-authentication-baseline.md),
[ADR-0018](ADR-0018-connector-managed-mcp-security.md) and
[ADR-0024](ADR-0024-delegated-user-identity-for-trusted-mcps.md). Acceptance
enables implementation; the verification gates below still apply to each surface.

Scope: a single connector that needs **both** a verified user at the MCP boundary
and the same user's provider credential downstream — today the SharePoint/M365
document MCP. Out of scope: new auth methods, new tables or services, public
connectors, and replacing either credential family.

## Context and verified gap

ADR-0017 separates caller authentication, user authorization and provider
authority, and for connectors such as SharePoint chooses "the verified user's
authorized delegated provider connection" over an ambient application identity.
ADR-0024 supplies the first half (a signed actor assertion at MCP ingress); the
connector's `connected_app` auth source supplies the second (the user's provider
token via `ConnectedAppTokenService.getValidToken`).

Verified live on 2026-10-18, the two were mutually exclusive:

- `agent-connector-runtime.service.ts` (~255) returns before auth resolution for
  any policy profile other than `configured`, so an `internal_jwt` connector
  never received a provider credential.
- `connector.service.ts` (~246) gates the conversation-v2 path the same way, and
  `admin-connector.controller.ts` resolves provider auth only for `configured`.
- The editor exposed security profile and auth source in one select
  (`CreateEditConnectorDialog.tsx` ~785) and dropped `runtimeAuthConfig` whenever
  the profile was `internal_jwt` (~415).
- `mcp-sharepoint` took Graph authority from a server-side `M365_ACCESS_TOKEN`,
  i.e. exactly the ambient tenant identity ADR-0017 rules out for user-facing
  operations.

The transport already supported composition: `McpJwtService.headers()` replaces
only `Authorization` for `internal_jwt` and preserves every other connector
header.

## Decision

1. **Ingress stays `internal_jwt`.** `Authorization: Bearer <assertion>` remains
   the only trusted identity at the MCP boundary; the actor is the verified `sub`
   (ADR-0024). No per-route audience fence is added.
2. **The provider credential travels in a separate header** declared by the
   connector's `runtimeAuthConfig` (for SharePoint: `http_header_bearer`,
   `headerName: X-M365-Access-Token`, empty prefix, raw token). Connectors may
   declare `authSourceType: connected_app` (+ `connectedAppKey`) together with
   `profile: internal_jwt`; the runtime resolves the acting user's token per call
   and merges it with the minted assertion. A resolved header set that fills the
   `Authorization` slot is refused (the assertion overwrites that slot), even
   when it also carries unrelated metadata headers, so agent runtime,
   conversation-v2 runtime, inspection and the editor all require a distinctly
   named provider header.
3. **Fail closed, never substitute.** If a declared provider credential cannot be
   resolved (no connection, expired/revoked token, connected-app failure), the
   call is denied. A `connected_app` connector never falls back to a stored
   static header, and neither credential may stand in for the other: an MCP must
   reject a provider token presented as the ingress assertion and vice versa.
4. **Receiver contract (mcp-sharepoint).** Verify the assertion exactly as today
   (algorithm, issuer, audience `mcp-sharepoint`, lifetime); require the
   delegated provider token for tool calls; refuse when the header is missing,
   repeated (a second blank occurrence still counts as ambiguous), or identical
   to the assertion; hold no tenant-wide Graph credential and keep no environment
   token fallback; run the `streamable-http` transport stateless
   (`stateless_http=True`) so no transport session retains either credential.
   The `sse`/`http` transports keep their previous launch path and are not
   covered by that guarantee.
5. **Editor contract.** Security profile and provider auth source become
   independent controls; the save payload carries both, including
   `runtimeAuthConfig` for `internal_jwt`. Audience remains mandatory for
   `internal_jwt`, `actorDelegation: verified_user` remains the only permitted
   delegation, and only `connectors.security.manage` holders may select it.
   Because the receiver adds the scheme itself, selecting `internal_jwt`
   defaults the provider header prefix to empty (and a saved `internal_jwt`
   connector reopens that way), so an untouched form delivers a raw token
   instead of an unusable `Bearer <token>`. Known limitation: for a saved
   connected-app connector the delivery configuration is write-once — the editor
   exposes it only while replacing credentials, so correcting a stored prefix
   means recreating the connector (which also drops its agent attachments).

## Alternatives considered

- **Provider token in `Authorization`** (`configured` profile, no assertion):
  rejected — it discards verified user attribution at the MCP boundary and makes
  the provider token double as the MCP credential, which ADR-0017 forbids.
- **MCP fetches the user token from the backend per call**: rejected for now —
  a new internal service boundary and an extra hop for no security gain, since
  the connector already resolves and injects per-user credentials.
- **Ambient application identity (`M365_ACCESS_TOKEN`) with user attribution by
  header**: rejected — an ambient tenant credential plus a caller-supplied
  identity is precisely the SharePoint audit's failure mode.

## Constraints carried from governing records

- ADR-0017: apply both profiles' controls (C1 for ingress, provider authority for
  downstream), fail closed, never let one credential family substitute for the
  other, keep secrets out of connector metadata and logs.
- ADR-0018: connector row is the authority (id/revision + `verified_user`
  re-check); no new service, table or runtime; both ends of trust must match.
- ADR-0024: one backend-signed assertion, actor from the signature only,
  permissions always the requesting user's, every delegated call attributed.

## Verification and acceptance

- Backend: `internal_jwt` + `connected_app` resolves the provider header and
  keeps the assertion in `Authorization` for the agent runtime, conversation-v2
  runtime and saved-connector inspection; a failed provider resolution denies the
  call; `internal_jwt` with `authSourceType: none` is unchanged; focused unit
  tests plus typecheck.
- Receiver (mcp-sharepoint): pytest covering delegated-token binding, denial when
  the header is absent/duplicated/echoes the assertion, invalid-assertion
  rejection, per-request isolation, and the absence of any environment fallback;
  live proof that an unauthenticated `initialize` is rejected.
- End to end: a saved connector's inspection lists tools, and a real tool call
  (`list_accessible_sites`) succeeds with the signed-in user's Graph identity and
  fails for a user with no active Microsoft connection.
- UI: independent profile/auth-source controls with EN/FR copy; editor tests and
  frontend QA on the real connector.
- Required high-risk review (auth boundary, both ends) before this is called
  complete.

## Rollout

SharePoint remains read-only until the connected app definition is widened and
the Azure app registration grants the matching delegated scopes with admin
consent (a prerequisite outside this repository). Rollback is reverting the
connector to a single credential family plus the receiver change; no schema
migration is involved.
