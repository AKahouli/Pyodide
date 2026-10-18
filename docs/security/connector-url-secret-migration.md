# R03: connector endpoint secret elimination

Status: **local implementation and required scoped review passed; not deployment-qualified**.
Source snapshot: `abe23f8f99d6d371f0bfd9155d5727327d0f3a17`, child branch
`fix/p1-scoped-authority`. Reviewed audit baseline `86bf7972` is an ancestor;
the three intervening commits concern conversation assets, preview verification
and Studio stream connections. No live connector records or credentials have
been inspected, migrated or deleted.

## Baseline source inventory and required corrections

| Boundary | Existing owner / symbol | Verified gap / required behavior |
| --- | --- | --- |
| Endpoint input | `connector/utils/remote-mcp-transport.util.ts::assertNoUrlCredentials` | Rejects userinfo but permits queries and some parse-invalid input. New endpoint writes must reject query/fragment credentials before persistence or network access, with a neutral error. |
| Public list/detail/create/update | `connector/connector.service.ts::toPublicResponse` | Allowlist omits runtime/server credential config, but URL helper preserves queries; description, auth schema and action schemas/descriptions are copied. Protect every copied field, not just endpoint URL. |
| Public URL helper | `connector/utils/remote-mcp-transport.util.ts::sanitizeEndpointUrl` | Returns raw input when no userinfo, including query/fragment; parse failure returns partially scrubbed raw text. Public output must fail closed and contain only canonical HTTP(S) origin/path. |
| MCP import | `connector/connector.service.ts::importFromMcp` | Persists raw `serverUrl` in description; derives fallback name/slug from raw last URL segment. Must use a neutral label / safe path and sanitize untrusted tool metadata. |
| Inspect output/error | `connector/connector.service.ts::inspectMcp`, `toSafeInspectErrorMessage` | Tool metadata is untrusted; SDK/provider errors strip userinfo/bearer only and can expose queries. Prefer fixed error codes/messages, no raw provider content. Existing logging is host-only. |
| Ordinary catalog export | `connector/services/catalog-transfer.service.ts::projectConnector` | Removes runtime/server config but preserves query URL and arbitrary descriptions/schema metadata. Export must apply the same public projection recursively. |
| Encrypted export | `catalog-transfer.service.ts::serializeArchive` and security export path | Preserve explicit privileged encrypted security archives; do not silently change to plaintext or lose the server-only operational endpoint needed for approved migration. |
| Catalog import/re-export | `catalog-transfer.service.ts::importConnectors` | Calls the userinfo-only validator. Unsafe new endpoints must not be reintroduced through archives. Existing transaction and revision/trust fences must remain. |
| Browser token issuance | `connector/connector.controller.ts::issueMcpToken` -> `McpJwtService.issue` | Returns saved operational `serverUrl` directly. Deny query-bearing legacy configurations before issuance; never issue a token for a silently altered destination. |
| ADK token renewal | `connector/controllers/connector-internal.controller.ts` -> `McpJwtService.renew` | Same issue result is used internally. Keep proof/connector/revision checks; distinguish runtime operation from browser projection. |
| Runtime signing/binding | `McpJwtService.headers/bindingAuth`, `ConnectorService.findByIdsForGrpc`, `agent/services/agent-connector-runtime.service.ts` | Operational URLs must remain server-only, not be silently stripped during metadata cleanup. Existing credential separation and destination policy remain authoritative. |
| Voice browser endpoints | `worky/voice/gemini-token.service.ts::mintSessionToken` | Loads runtime connector rows; exposes userinfo-only sanitized endpoints and raw action declarations. Deny unsafe legacy browser routing and project declarations before provider token creation. |
| Import audit persistence | `connector/admin-connector.controller.ts::importFromMcp` | Logs `{serverUrl: body.serverUrl}`. Store only nonsecret host, opaque connector ID/count and/or endpoint fingerprint. Never log any query, even with a benign-looking parameter name. |
| Health | `health/health.service.ts::checkPlaybookMcp` | Reads configured URL but derives `/health/ready` and returns fixed status text, not raw endpoint/provider errors. No observed endpoint exposure at this sink. |
| Thematic memory runtime | `worky/voice/thematic-memory.service.ts` | Server-only connector use; preserve operational credential behavior and review exception/log serialization before closure. |

## Intended compatibility contract

- One strict public endpoint projection: HTTP(S) scheme + canonical host/port/path,
  no userinfo/query/fragment; malformed input yields no raw fallback.
- Runtime URLs remain in existing server-only connector records. This does not
  introduce a new table, service or public raw-endpoint field.
- New create/update/import/inspect requests are query-free. Existing records that
  need query authentication are not silently rewritten; browser JWT/voice use
  fails closed until an explicit credential migration is approved and verified.
- Existing public DTO allowlists remain. Untrusted description/schema/action
  content needs structural filtering plus endpoint-derived secret removal and
  parsed embedded-URL projection; a regex alone is not a sufficient boundary.
- Provider tokens remain separate from the actor assertion (ADR-0026). Approved
  query migration uses a connector/destination-bound encrypted server-only header
  envelope in existing `runtimeAuthConfig`, protected by existing `CryptoService`.
  The generic connector credential store writes JSON and is not an encrypted
  destination. Existing connected-app delivery remains separate; always use an
  explicitly declared header, never infer a provider's header scheme.

The user approved that named encryption design on 2026-10-18, with no new service
or table. `POST admin/connectors/:id/migrate-query-headers` is the explicit admin
operation is implemented: normal update plus
`connectors.security.manage`, expected security revision, complete per-parameter
map/remove decisions and explicit header/prefix mappings. It must atomically store
the safe endpoint, encrypted header payload and scrubbed copied metadata. No live
migration, startup rewrite or historical audit deletion is authorized. Portable
security material belongs only inside privileged encrypted archives and must be
re-encrypted for the actual target connector/destination/deployment key; ordinary
roundtrips must preserve hidden security material rather than overwrite it with a
display projection. Required scoped encryption/migration/portability review passed
after the destination, concurrency and privileged-binding authorization corrections.

### Enforced local boundaries

- The encrypted migration receipt includes the original expected revision and
  complete mapping/removal plan. An exact retry is read-only and valid only at the
  immediate resulting revision; changed plans or later security revisions reject.
- Runtime ID/slug/batch lookups compare the actual connector URL with the bound
  encrypted destination before callers decrypt or construct a transport. Opening
  the payload additionally authenticates connector ID, destination and purpose.
  Missing explicit encryption configuration cannot use the legacy development key.
- Evidence runtime supports the declared encrypted provider header alongside the
  separate internal-JWT actor assertion. Case-insensitive caller/dynamic header
  substitution is denied; a public profile cannot carry this encrypted auth.
- Metadata scrubbing retains only validated canonical execution-control enums
  (for example action safety `read`); it never restores copied keys, descriptions
  or schemas. Removing a benign query flag must not corrupt action classification.
- Catalog overwrite always uses the observed security revision. CAS is not
  authorization: changing a privileged connector's actual binding also requires
  current `connectors.security.manage` passed from the authenticated controller.
  Existing security-transfer permission checks remain separate and unchanged.
- Ordinary overwrite preserves encrypted-target auth, destination, static server
  configuration and dynamic headers. It cannot downgrade an encrypted target to
  plaintext auth. A missing post-insert/overwrite result throws rather than
  reporting success, allowing the surrounding import transaction to roll back.

### Verification evidence and limits

The final affected run passed **9 suites / 170 tests** across connector service,
auth, real AES-GCM, admin/controller HTTP, catalog/portable archives and evidence
runtime. Production `tsconfig.build.json` no-emit compilation passed. Coverage
includes real encryption and cross-deployment-key/connector-ID portability,
header-only runtime resolution, actual mocked MCP calls for configured and
internal-JWT profiles, neutral serialized DTO/audit output, required permissions,
strict nested migration DTOs and forced write/conflict failures.

Encrypted archive rollback/interleaving fixtures verify the service's
throw/CAS/transaction contract rather than reproducing every encrypted scenario
on PostgreSQL. The initially skipped database gap was subsequently exercised on
an isolated test database: backend migration command PASS, **3 actual catalog
atomicity tests plus 1 real concurrent-revision CAS test PASS**, and **8 workspace
store/access-filter tests PASS**. This uses the repository's PostgreSQL 16 /
pgvector 0.8.0 CI image with `vector` and `pg_trgm` activated; no application
database was touched. All task-owned disposable test containers were removed.
The implemented catalog transport serializes JSON/encrypted JSON; there is no
connector ZIP path in this module to certify. Live providers, full application
startup, backend database-backed current-rights checks, deployment mounts/rotation
and external consumers remain separate qualification gates. No live records were
migrated or reconciled and no historical audit evidence was deleted.

## Historical reconciliation (operator-owned)

`scripts/security/inventory-connector-endpoint-secrets.mjs --dry-run` accepts a
JSON array of `{recordType,row}` synthetic/exported fixtures on stdin. Its explicit
`--postgres` mode requires operator-provided `PGHOST` and `PGDATABASE`; it opens a
read-only repeatable-read transaction and pages `integrations.connectors` plus
`authz.audit_logs`. It loads no `.env` file and prints no database error details.
Do not run PostgreSQL mode on a live environment without the owner's approval.
Pure inventory regressions run with:

```text
node --test scripts/security/inventory-connector-endpoint-secrets.test.mjs
```

The implementation must provide a read-only dry run for connector fields and
audit metadata. Output IDs, field names, parameter names and counts only. Do not
output raw descriptions, endpoint queries, credentials, assertions, object keys
or signed URLs. Running it against live data is not authorized by this plan.

Actual migration requires an approved per-record destination/auth mapping,
expected security revision, encrypted server-only credential storage and an
idempotent rewrite. Rewrites must not run automatically on application startup.
Historical audit cleanup requires retention/incident-preservation approval;
do not delete evidence or infer compromise from a hypothetical leak.

Malformed legacy endpoints whose credentials cannot be classified are quarantined
in public metadata and ordinary exports: disabled structural stubs retain only
opaque identity / safe constants, with no copied free-text, schemas or actions.
Runtime rows are not rewritten; privileged encrypted archives retain originals.
Valid legacy query URLs receive display-only origin/path projection and recursive
removal of copied endpoint values. Malformed percent encoding / UTF-8 fails closed.

Implemented local checks cover strict URL writes, public/admin serialized HTTP,
ordinary and encrypted catalog exports, token/voice denial, neutral inspection
errors and import audit fields. Focused security review closed its malformed
metadata finding after malformed-query, malformed-userinfo, `%ZZ`, `%FF` and
truncated UTF-8 regressions. This is not a whole-R03 or whole-P1 sign-off:
an approved credential-migration execution and real integration/rollout evidence
remain required; no live reconciliation has run.

## Required evidence before closure

- Synthetic `TEST_CANARY_R03` absent from serialized public/admin DTOs, ordinary
  JSON/ZIP exports, token/voice responses, inspect errors and persisted audit
  metadata, including nested schema/action content and encoded query variants.
- Unsafe writes and malformed URLs reject before persistence/network/token mint.
- Encrypted privileged export/import retains its authorization/encryption contract.
- Approved query-to-header migration preserves successful server-side MCP calls.
- Focused tests, required security review and separately identified rollout /
  historical reconciliation evidence; no unit-test-only production certification.
