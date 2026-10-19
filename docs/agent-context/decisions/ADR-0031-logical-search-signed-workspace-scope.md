---
id: ADR-0031
status: accepted
scope: logical-search-signed-workspace-read-scope
accepted_at: 2026-10-19
---

# Logical Search locally verified multi-workspace read scope

User approval: multi-workspace searches, no MCP-side authorization round trip,
configurable 180-second lifetime, followed by “go” on 2026-10-19. This extends
ADR-0017/0018/0023; it does not supersede them or establish ADR-0024 trust-class
membership. Central platform decisions govern the external Logical Search repo.

## Contract

- Explicit privileged connector policy `workspaceAuthorization: true` enables a
  signed read-scope snapshot. It requires `actorDelegation: verified_user`, a
  configured audience, streamable HTTP, and either `internal_jwt` or `configured`.
  For `configured`, this is the receiving server's administratively declared
  two-header assertion capability (ADR-0023), never server-advertised metadata.
- Reuse McpJwtService, its RSA key/issuer, connectorId/securityRevision and proof-
  bound renewal. No new credential type, issuer, service, table or namespace.
- Signed claim `workspaceScope: { version: 1, permission: 'read', ids: string[] }`
  contains canonical backend workspace IDs accessible by ownership, sharing or
  public access at issuance. No storage-prefix/name alias grants access. Indexing
  sends canonical workspace ID as brain_id; storagePrefix is a separate path name.
- Snapshot collection is bounded (100 IDs); overflow fails rather than silently
  truncating authority. Empty scope permits discovery but no data access. ADR-0032
  amends only the numeric bound (configurable `MCP_WORKSPACE_SCOPE_MAX_IDS`, default
  1000); the fail-closed rule and all other constraints here remain in force.
- `MCP_WORKSPACE_SCOPE_TTL_SECONDS` defaults to 180, integer 1..300, on the issuer.
  Scope and enclosing assertion share expiry. Renewal reloads account, connector,
  revision, permissions and workspace access; never copies prior scope claims.
- The MCP validates signatures/issuer/audience/lifetime and pinned connector
  revision locally with deployment-managed public key/config. Header and tool
  workspace lists may only narrow signed scope. Missing/invalid identity or scope
  fails closed on data access. No backend calls or key downloads on search paths.
- Shared-key ingress always remains required in two-header mode. Bearer-only
  discovery may proceed, but bearer-only data operations are forbidden. Invalid
  supplied assertions reject even discovery. No identity-header fallback.
- Stateless HTTP avoids cross-actor session ownership/state reuse. SQL scoping
  remains mandatory on every protected retrieval surface.

## Revocation and deployment

Local verification deliberately accepts up to the configured TTL of stale
membership/account/connector authority. Deploy receiver revision changes to revoke
old assertions immediately at that receiver; backend revision changes alone take
effect on renewal/expiry. Public-key rotation requires coordinated provisioning.
Do not describe backend policy changes as instantaneous local revocation.

Both sides must be provisioned and the connector explicitly opted in before use.
Acceptance is not evidence of live deployment or isolation qualification. Tests
must cover multi-workspace subsets, mixed denied batches, revoked sharing on
renewal, expiry, malformed/duplicate credentials, stateless concurrent identities,
and no protected database/model work on rejection.
