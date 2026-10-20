---
id: ADR-0033
status: proposed
scope: first-party-mcp-jwt-only-callbacks
proposed_at: 2026-10-20
---

# JWT-only first-party MCP callbacks

## Intent and approval

The user explicitly approved JWT-only semantic, Playbook, Agent and Logical
Search MCP authentication on 2026-10-20, with no legacy fallbacks. This proposed
record documents that implementation direction; it does not certify deployment.
It proposes replacing ADR-0024's separate machine-secret requirement and
ADR-0031's additional static ingress credential, within this scope only.
Accepted historical records remain unchanged.

## Contract

- Semantic, Playbook and Agent backend callbacks require the forwarded,
  backend-signed RS256 assertion. The existing route-owned expected audience,
  issuer, lifetime, signed actor, connector ID, current connector security
  revision, verified-user delegation, account access and resource permissions
  remain mandatory. A service-name header is never authentication authority.
- Audit principal attribution is derived from verified route/connector authority,
  not a caller-supplied service name. Missing or invalid assertions fail closed;
  static service tokens and naked user-ID headers cannot substitute for them.
- The forwarded assertion is a bearer capability, not independent proof that the
  caller process is a specific workload. Its permitted use is bounded by the
  verified connector/audience and actor permissions. This deliberately removes
  the separate static machine credential; it does not claim mTLS/workload identity.
- Backend signing configuration uses only `MCP_JWT_PRIVATE_KEY_FILE` and
  `MCP_JWT_ISSUER`. Semantic-prefixed signer aliases have no fallback behavior.
  Receiver-side issuer/audience/public-key configuration remains necessary.
- Logical Search verifies its JWT and signed bounded workspace scope offline.
  It has no backend authorization callback. Its protected HTTP ingress accepts
  the signed assertion without a second static credential or legacy-service mode.
  ADR-0031/0032 workspace subset, lifetime and size constraints remain in force.
- Other internal services (Root/ADK, app runtime, semantic runtime and artifact
  operations) retain their existing scoped credentials and authority contracts.

## Deployment and verification

Deploy backend and MCP callers together. Configure canonical signer settings
before removing aliases; retain the same signing key/issuer. Confirm connector
policies use the intended audience and verified-user delegation. Remove retired
MCP callback secrets from deployment mounts only after all affected consumers
are migrated. Never remove credentials belonging to other internal services.

Verification must cover both caller and receiver: valid JWT without static
headers succeeds; missing, expired, wrong-domain, invalid-signature and stale
revision assertions fail; user spoofing and permission violations fail; audit
attribution cannot be forged. Logical Search also requires signed-scope isolation,
HTTP control regressions and health-probe/CI migration. Required security review
and runtime qualification are tracked separately from this proposed decision.
