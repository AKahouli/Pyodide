---
id: ADR-0030
status: proposed
scope: p1-domain-and-job-bound-internal-authority
supersedes: ADR-0024-cross-domain-audience-policy
proposed_at: 2026-10-18
---

# P1 domain- and job-bound internal authority

## Status and implementation authorization

Proposed superseding record; final security review and deployment qualification
remain separate. The user requested implementation of the named R01/R02/R03 P1
plan on 2026-10-18. That request explicitly restores domain-bound MCP audiences,
changing ADR-0024 §3. The user separately approved `SemanticAssetGrantService`
inside the existing semantic-model module (no new table/deployed service), selected
removal of the unknown-consumer raw-key signer, and approved exact-document,
model-less discovery admission so pre-model profiling keeps working.
The user also approved connector/destination-bound encrypted server-only header
payloads in existing `runtimeAuthConfig` using existing `CryptoService`, with an
explicit revision-checked admin query-to-header migration and no new service/table.

Preserve accepted ADR-0024 history. This proposal records the user-directed change
and must not be cited as proof that its implementation or deployment is complete.

## Decision under implementation

1. Each internal domain authenticates a fixed machine principal with a distinct
   credential. Principal names `mcp-agent` and `mcp-playbook` differ from connector
   slugs. Preserve `semantic-model-mcp`, `adk-runtime` and `app-runtime`; give
   semantic asset, ADK root and artifact flows separately scoped identities.
   Reject ambiguous headers, blank/padded/short production keys and accidental
   key equality. Never fall back to `INTERNAL_SERVICE_SECRET`.
2. MCP domain routes fix the expected actor audience in controller/guard metadata.
   Reuse `McpJwtService.verifyMcpAssertion` with its current user, connector,
   `verified_user`, revision and permission checks. Agent, Playbook and Semantic
   assertions do not cross domain boundaries merely because they share a signer.
   Keep stateless transport and assertion/provider credential separation from
   ADR-0017/0018/0026.
3. A machine identity plus caller-selected actor/job/execution IDs is insufficient.
   Semantic admissions must be backend-signed and match canonical durable job/task
   state. Grants live at most five minutes and bind exact source/version,
   operation and live lease epoch with an unforgeable execution proof; each
   read/write/refresh rechecks actor rights and current job state.
4. Population requires the current model/source binding. Model-less discovery is
   a separately signed purpose limited to the exact uploaded document/version
   and profiling operations. It cannot acquire model graph/population authority,
   replace `createdBy`, change document/workspace, or bypass current access checks.
5. ADK root and artifact calls require live execution-bound proof, not an MCP
   assertion or naked owner/fence selector. Existing domain authorization and
   artifact ownership checks remain necessary after authentication.
6. Retire the unconsumed arbitrary-key signer; preserve existing resource-ID
   download APIs. Do not invent a broad presign principal for unknown consumers.
7. Public endpoint projection is HTTP(S) origin/path only; unsafe new endpoint
   writes reject. Operational legacy URLs stay server-only until an explicitly
   approved encrypted credential migration. Browser JWT/voice routing denies
   unsafe destinations rather than stripping their operational authority.
   Ordinary exports and metadata omit secret-capable objects and sanitize copied
   endpoint material. Audit records never contain raw query URLs.
8. Query-to-header migration requires normal connector update permission plus
   `connectors.security.manage`, an expected revision and explicit complete
   parameter/header/prefix mappings. The generic credential store is JSON, not an
   encrypted destination. Privileged encrypted archives re-encrypt portable header
   material for the actual target connector/destination/key; public and ordinary
   exports never carry it. Approval of this design does not authorize live record
   migration or historical audit deletion.

## Verification and rollout

See `docs/security/internal-principal-inventory.md`,
`document-presign-contract.md`, `connector-url-secret-migration.md` and
`semantic-asset-grant-contract.md` for exact implementation/evidence. Local synthetic tests
are not PostgreSQL/Ceph or deployed TLS/rotation certification. R01/R02/R03 remain
open until their implemented boundaries, legitimate flows, required review and
external/deployment gates are verified. No production mutations or pushes are
authorized by this decision.
