---
id: ADR-0032
status: accepted
scope: logical-search-workspace-scope-max-ids
supersedes: ADR-0031 workspaceScope 100-ID bound only
accepted_at: 2026-10-19
---

# Configurable Logical Search workspace-scope bound

User approval: on 2026-10-19 the user chose to raise the ADR-0031 signed-scope
bound to a configurable value with default 1000 instead of lowering broad users'
workspace access or keeping the 100-ID fail-closed cap. This record supersedes only
the `100 IDs` bound in ADR-0031; every other ADR-0031 constraint (locally verified
signature/issuer/audience/lifetime, canonical IDs, explicit connector opt-in,
fail-closed overflow, no per-search backend round trip, 180-second TTL capped at
300) remains in force.

## Context

Live local qualification showed that the full readable set of real users exceeded
100 workspaces (owner 114, shared user 152). Because ADR-0031 signs the complete
entitlement snapshot and fails closed on overflow, those users received
`403 ERR_1902` at issuance and could not use Logical Search at all. Narrowing the
snapshot silently would drop authority, so the bound itself had to change.

## Decision

- The signed snapshot remains the complete owner/share/public readable set at
  issuance. It is still bounded and still fails closed on overflow.
- The bound is `MCP_WORKSPACE_SCOPE_MAX_IDS`, integer 1..1000, default 1000, on both
  the backend issuer and the Logical Search receiver.
- The issuer requests `max + 1` rows and rejects more than `max`; the receiver
  rejects any scope whose ID list exceeds its configured `max`. A backend configured
  higher than its receiver therefore fails closed at the receiver, never silently
  widens.
- Both deployments must be provisioned with the same bound. A token with more IDs
  than the receiver accepts is unauthorized, so raising the bound is a coordinated
  contract change, not a backend-only setting.
- ID lists remain unique, canonical 24-character lowercase hex; empty scope still
  permits discovery only.

## Consequences and verification

- At 152 IDs the assertion is about 6.4 KB; at 1000 IDs about 37 KB. The assertion
  travels in `X-YellowStorm-Mcp-Assertion`, so ingress header limits must accept the
  configured worst case. Prefer the smallest bound that covers the tenant population.
- Focused verification: backend workspace-share/internal controller 22 tests passed
  (default overflow at 1001, 152 accepted, configured 50 rejects 51); receiver
  signed-assertion suite 6 tests passed (152 accepted, 1001 rejected, configured 50
  rejects 51).
- Live re-qualification confirmed the owner (114) and shared (152) users now receive
  scopes that include the target workspace and return results, a 1000-ID assertion is
  accepted through the header path, and a 41-workspace user whose scope excludes the
  target is still denied. Multi-instance and clean-dependency rollout remain unverified.
