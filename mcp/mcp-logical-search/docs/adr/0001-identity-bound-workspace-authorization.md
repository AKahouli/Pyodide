# ADR-0001: Bind workspace authorization to validated identity

- Status: Superseded by ADR-0002
- Date: 2026-10-16
- Decision owners: Service maintainers and gateway/identity owners; people to be assigned
- Related audit finding: 01, High, security audit of commit `99bd129`
- Implementation / verification: Repository enforcement implemented; gateway/deployment verification pending

## Context

This record preserves the initial static-mapping decision for traceability.
It is no longer the implementation contract. The user confirmed that workspaces
are dynamic and requested removal of those settings. See
[ADR-0002](0002-dynamic-workspace-scope-from-trusted-header.md) for the accepted
header-based design; the mappings described below have been removed.

Before this change, the service authenticated callers with a shared bearer API key. In
`APIKeyAuthMiddleware`, caller-supplied `Workspace-Id` values also initialize
the scope treated as authorized by MCP workspace validation. Checking tool
arguments against those values prevents scope mismatch, but does not establish
the caller's entitlement to those workspaces.

The audit and historical architecture documented this limitation. Standalone
HTTP endpoints also accepted workspace/file scope directly from the request.
They require the same boundary protection rather than assuming MCP validation
applies to them. The unused signing-key variable in CI was removed; this change
does not introduce signed claims or a custom token protocol.

The audit did not verify deployed gateway controls or PostgreSQL row-level
security. The available evidence cannot establish that production traffic is
already isolated. A private network or a shared service key alone does not
prove individual workspace authorization.

## Decision

Keep `Workspace-Id` as a fixed header supplied outside the LLM, and bind its
maximum scope to an authenticated service principal:

1. Establish allowed workspaces from server-side configuration: the existing
   `MCP_API_KEY` uses `MCP_ALLOWED_WORKSPACES`; additional credentials use
   `MCP_CLIENT_WORKSPACES`. Caller-supplied scope is
   a request to narrow access, never the source of entitlement.
2. Deny access when identity or entitlements are absent, invalid, expired, or
   unavailable. Reject requests containing any unauthorized workspace; do not
   silently expand or partially accept their scope.
3. Apply the same authorization policy to MCP tools and any HTTP endpoint made
   available to tenant callers, including readers, images, citations, summaries,
   native searches, and document routing profiles. Resolve selected IDs and
   filenames within the authorized scope before reading data or invoking models.
4. Prefer one shared policy boundary over separate per-endpoint rules. Preserve
   SQL scope filters as enforcement in depth; do not rely on response filtering.
5. Keep existing trusted-service HTTP capabilities restricted to explicitly
   authorized service principals and private routes until their ownership and
   scope policy are defined. Internal services with broad access require explicit
   entitlements and auditability too.

The service verifies the bearer credential and its configured workspace mapping
on every request. The header may narrow that mapping; it cannot grant additional
workspaces. MCP still requires the header. HTTP body-scoped callers may omit it,
but remain restricted by credential permissions. Filename-only HTTP discovery
also uses those permissions in SQL. Empty permissions fail closed.

For end-user identity, the trusted gateway remains responsible for validating
user entitlements, stripping caller-provided scope headers, injecting the fixed
permitted scope, and preventing direct backend access. Give it appropriately
scoped service credentials; a broad shared key must not be handed to tenants.
Credential rotation and deployment instructions are in
[security configuration](../security-configuration.md). Named operational owners
and deployed gateway evidence remain to be assigned/provided.

## Alternatives considered

| Alternative | Assessment |
| --- | --- |
| Shared bearer key plus arbitrary workspace header | Previous behavior; does not identify workspace entitlements. |
| Network restriction alone | Useful immediate containment, but does not authorize a tenant or resource. |
| Scoped credentials with a server-side mapping | Selected: reuses bearer authentication, supports multiple workspaces, and requires no new identity protocol. |
| Signed identity claims or remote entitlement lookup | Possible future replacement when gateway integration requires it; adds protocol and availability dependencies. |
| PostgreSQL row-level security alone | Possible additional protection; requires ingestion/schema ownership and connection-context design, and does not govern model calls or route exposure. |

## Consequences

- Cross-workspace requests can be rejected before database reads and external
  model calls; the shared API key remains service authentication only.
- Gateway/identity availability and credential rotation become operational
  dependencies. Lookup failure denies access and needs observable error handling.
- Existing clients may need identity context or scoped service credentials.
  Coordinate rollout and compatibility tests before enforcing the new contract.
- This is a focused authorization change. Ranking, ingestion, and citation ID
  formats do not need redesign as part of this decision.
- Acceptance of this ADR does not close findings about model disclosures, public
  probes, workload limits, images, logs, database TLS, or container hardening.

## Implementation and verification

The runtime controls are implemented. The outstanding items below include
deployment evidence and accountable operational ownership; acceptance is not a
claim that the gateway has been audited.

- [x] Select configured credential mappings and service-side verification.
- [x] Enforce scopes for MCP and standalone HTTP routes, including filename-only discovery.
- [ ] Assign named service/gateway owners and verify production entitlement provisioning.
- [ ] Specify credential provisioning, revocation, rotation, and migration for existing clients.
- [x] Test missing credentials/permissions, forged workspace headers, and mixed allowed/denied batches. Tokens with expiry and remote lookups are not used by this implementation.
- [ ] Test cross-workspace document, section, block, image, filename, and citation IDs, including duplicate names/aliases.
- [x] Verify rejected HTTP scopes perform no protected reads or content-bearing model calls in regression tests.
- [x] Verify scoped internal callers preserve valid HTTP arguments and payloads in regression tests.
- [ ] If using a gateway, verify header stripping and that the backend cannot be reached through a bypass route.
- [ ] Link implementation PRs and passing automated and deployed-environment evidence before closing finding 01.

## References

- [Security audit report](../Report_security_audit_MCP_Logical_Search%201.pdf), pages 2-3, finding 01.
- [Security cleanup plan](../security-cleanup-plan.md).
- [Existing production-readiness history](../maintenance-history.md#production-readiness-roadmap).
- [HTTP authentication and standalone routes](../../src/mcp_server/router.py).
- [MCP workspace context and validation](../../src/mcp_server/logical_indexing_server.py).
- [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny by default and validate permissions on every request.
