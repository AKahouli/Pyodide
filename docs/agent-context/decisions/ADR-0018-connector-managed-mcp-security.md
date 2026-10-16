---
id: ADR-0018
status: accepted
scope: connector-managed-mcp-security-and-isolation
source_paths:
  - mcp/mcp-semantic-model/auth.py
  - mcp/mcp-semantic-model/server.py
  - yellowstorm-adk/src/mcp/__init__.py
  - yellowstorm-adk/src/mcp/jwt_auth.py
  - yellowstorm-adk/src/smart_rag/tools/utilities/connector_tools.py
  - YellowStorm/back/src/modules/connector/services/mcp-jwt.service.ts
  - YellowStorm/back/src/modules/connector/utils/mcp-security-policy.ts
  - YellowStorm/back/src/modules/connector/utils/mcp-destination-policy.util.ts
  - YellowStorm/back/src/modules/connector/admin-connector.controller.ts
  - YellowStorm/back/src/modules/connector/admin-catalog-transfer.controller.ts
  - YellowStorm/front/src/modules/admin/pages/connectors/CreateEditConnectorDialog.tsx
reviewed_at: 2026-10-16
---

# Connector-managed MCP security and request isolation

## Status, scope and relationship to ADR-0017

This companion decision consolidates the user's approved direction: stateless
Semantic Model MCP, shared MCP ownership, and security administration through a
**simpler existing Connector UI**. The user confirmed the concrete named design
and authorized implementation with “go” after the policy/RBAC/package proposal.
That approval covers the fields, permission, renewal principal and package location
below, under [change control](../architecture/change-control.md). It is not deployment
approval or certification of every ADR-0017 control. Implementation review and QA
outcomes must be recorded separately.

[ADR-0017](ADR-0017-mcp-security-and-authentication-baseline.md) remains the accepted,
generic security contract and authentication-profile selector. This record neither
supersedes it nor mandates JWT for all MCPs. No existing MCP is a certified reference.
The control plane must meet ADR-0017; UI configuration cannot relax it.

## Evidence and existing ownership

The following are pre-change observations motivating this decision, not a
description of the final implementation. Current owners are in `source_paths`.

- A bounded in-memory HTTP probe with repository middleware, FastMCP 2.14.7 and
  installed MCP SDK 1.30.0 reproduced: Bob's valid JWT plus Alice's MCP session ID
  executes a diagnostic tool with Alice's actor and assertion (HTTP 200). This was
  confirmed with the default SSE response mode. It requires another user's session
  ID; no session-ID leak or real-data access was demonstrated.
- Custom middleware establishes ContextVars but not the SDK's authenticated session
  owner. Stateful session tasks retain initialization identity. The assertion is
  also set before its reset token is captured, leaving it behind after a request.
- Separate sessions retained Alice/Bob identity in a concurrent probe. Existing
  Python auth/client tests passed (47); issuer/actor-guard tests passed (28). These
  results did not cover or prevent the transport defect and are historical evidence,
  not verification of a fix or of future changes.
- Conversation connector tools import `call_mcp_tool` from `flow_engine.mcp`, as do
  Playbook callers. Its ownership is therefore shared despite its feature directory.
- The backend issuer signs for several hardcoded MCP names; verification still
  assumes the semantic-model audience. Trust/egress helpers duplicate endpoint lists.
- The existing connector editor exposes auth source, injection strategy, credentials,
  transport, endpoint and JSON configuration together. Ordinary connector updates
  currently require `CONNECTORS_UPDATE`; catalog security transfer separately checks
  `CONNECTORS_TRANSFER_SECURITY`. Neither establishes an approved permission for the
  delegation/private-network trust controls selected here.

These observations identify reuse owners and gaps, not compliant templates.

## Decisions

### 1. Request isolation precedes structural cleanup

Explicitly configure Semantic Model MCP for stateless HTTP. Authenticate and bind
each request independently; a supplied/old transport session ID must not select
another actor's execution context. Conversation history remains application-owned.
Verify initialization, discovery, calls and client compatibility with the pinned SDK.

Validate credentials without mutating ambient identity first; establish actor,
assertion and logging context inside one cleanup boundary. Restore previous values
on every exit, including rejected identity, exceptions and cancellations. Keep
backend permissions/resource ownership authoritative. Token renewal must reach the
current call rather than retain an initialization assertion.

This transport decision applies to Semantic Model MCP. New MCPs select transport
deliberately: prefer stateless HTTP when persistent protocol state is unnecessary;
stateful exceptions require verified ownership binding and per-call identity tests.

### 2. The existing Connector UI is the administration surface

Use the existing connector domain as the source of configured security policy.
Do not create a second deployment endpoint registry as the primary control plane.
Endpoint addresses are configuration data, not feature names hardcoded in signers.
Signing keys, service secrets and the receiving MCP's verifier remain securely
provisioned outside ordinary connector metadata. Matching both ends of trust is
required; selecting a profile in the UI does not configure a remote verifier.

Backend-enforced privilege is required to grant/change actor delegation, internal
JWT recipient settings or private-network exceptions. Separate those capabilities
from ordinary connector editing and enforce them on every write path, including
create/update, imports, duplication, inspection and any configuration JSON path.
An unprivileged metadata update must preserve existing policy without allowing an
endpoint or auth change to redirect its credentials. Client-submitted fields or
hidden UI controls are never authority by themselves.

### 3. Make the UI simpler through progressive disclosure

Interaction model, to validate in frontend QA:

1. **Connection:** name, endpoint and transport, followed by a connection test.
2. **Authentication:** choose a plain-language method and show only its relevant
   fields/status. Distinguish service authentication, acting-user delegation and
   provider connection without making administrators configure token injection.
3. **Advanced:** collapsed protocol overrides/JSON and specialist options. Keep
   branding, action catalog and unrelated behavior out of the connection's primary
   path; preserve their existing capabilities in secondary sections.

Privileged security details appear only to authorized administrators and only when
relevant. Prefer one understandable credential status with explicit replace/remove
actions over simultaneous unrelated switches. A simple read-only summary explains
the effective identity and access. It must not call a connection secure merely
because an endpoint responds or inspection succeeds. Validate labels and EN/FR copy;
keyboard use, error states and preserved settings are acceptance criteria.

### 4. Centralize policy resolution without conflating trust

Resolve current connector policy in the existing backend connector ownership for
inspection, execution, token issuance and renewal. Derive the acting user from
authenticated execution/delegation, never editable tool arguments. Check user access,
account state and connector availability before issuing/renewing credentials.

Keep authentication profile, recipient/audience, permission to delegate a user and
private-network allowance distinct even if a preset simplifies their presentation.
Do not trust a slug, returned server metadata or a model-selected URL. Validate the
exact canonical destination before credential attachment; preserve case-sensitive
paths, explicit transport rules, DNS/IP protections and redirect restrictions.
Only a separately authorized exact destination qualifies for an internal exception.

Changing endpoint/profile/audience or revoking/disabling policy must revalidate or
invalidate its grants before further credential issuance. Copies/imports must not
inherit privileged trust automatically. Bind runtime credentials to the validated
connector/destination; do not accept stale client policy as authority. Specify
cache invalidation and the bounded residual lifetime of already-issued credentials;
do not promise immediate JWT revocation without an enforcement mechanism.

### 5. Neutral shared client and profile-specific JWT ownership

Move reusable Python MCP transport/auth helpers out of `flow_engine/mcp` to a
neutral shared package `yellowstorm-adk/src/mcp/`. Migrate conversation, Playbook and other located
consumers/tests to one implementation; remove old implementation after migration.
Preserve supported transport/auth behavior and do not migrate unrelated servers.

Rename the existing issuer to `McpJwtService` / `mcp-jwt.service.ts` within the
connector module. It implements ADR-0017 C1 only, not generic mandatory MCP auth.
Pass expected audiences from trusted backend policy to generic verification;
domain guards retain resource authorization. Configure the signer only when an
active authorized C1 integration requires it, with fail-closed missing/invalid
configuration. Keys/issuer are deployment-managed; per-connector endpoint/profile/
audience/delegation policy is administration-managed.

Do not introduce a universal auth SDK or new runtime/service in this cleanup.
Scope renewal principal permissions explicitly: the current helper's semantic-model
service credential must not silently become a universal impersonation credential.

### 6. Compatibility and rollout are explicit

Inventory current connectors/env trust entries and classify their intended profiles.
Use a bounded migration adapter/seed for existing deployments; define precedence,
conflict handling, removal criteria and an auditable mapping to connector policy.
Do not promote every old URL/header configuration to privileged trust automatically.
Preserve stored credentials and never expose their plaintext in reads/exports.

Implement/test Semantic isolation independently first. Then migrate shared clients
and policy consumers in bounded stages. Keep transport/session rollback separate
from configuration rollback: do not re-enable the verified unsafe stateful path or
weaken auth to recover availability. Deny affected calls until a secure alternative
is available. Public/external connectors retain their selected profiles.

## Consolidated delivery plan

Priorities reflect the verified isolation defect first. Implementation is tracked
by the task checkpoint and source/tests; this table is not a claim of completion.

| Priority | Work | Ownership | Required outcome/evidence |
| --- | --- | --- | --- |
| P0 | Stateless Semantic transport | `mcp/mcp-semantic-model/server.py` | Explicit per-request execution; ADK initialization/discovery/calls compatible; old/foreign session ID cannot select identity |
| P0 | Context cleanup | semantic MCP `auth.py`, backend client boundary | Actor/assertion/log context restored on success, rejection, exception, cancellation and nested context; fresh token used |
| P0 | Isolation regressions | semantic MCP transport tests + downstream assertion probe | Concurrent/sequential Alice/Bob calls, attempted session substitution, renewal and failures; no unauthorized side effects |
| P1 | Approve precise policy contract | existing connector DTO/types/store/RBAC owners | Confirm fields, persistence/migration, privileged permission mapping and principal scope; no new service/table presumed |
| P1 | Shared Python client extraction | ADK shared package + conversation/Playbook callers | Approved neutral path, one implementation, all located imports/tests migrated; transports, renewal and destination controls preserved |
| P1 | Generic JWT cleanup | backend connector issuer and domain guards | Rename/wiring/tests; trusted expected audience; wrong-audience denial; no hardcoded feature-name dispatch |
| P1 | Connector-managed policy | existing backend connector module | One policy resolution path for inspection/execution/issuance/renewal; exact target binding and separate trust permissions |
| P1 | Privileged write protection | create/update/import/copy/inspection + JSON paths | Direct API attacks cannot grant/redirect trust; endpoint/profile changes and revocation take effect under documented lifecycle |
| P1 | Simplified editor | existing connector admin UI + EN/FR | Connection/auth primary path, conditional inputs and collapsed advanced details; preserved credentials/settings; browser QA |
| P1 | Legacy migration | config/bootstrap and connector persistence owners | Explicit env-to-policy mapping, precedence and removal gate; no secret leaks or silent trust promotion; safe rollback |
| P1 | Boundary/security verification | backend + ADK + MCP + required reviewer | Denied spoofing/egress/privilege escalation; both ends of delegation and renewal; conversation and Playbook integration |
| P2 | Documentation/reference qualification | affected READMEs/context + ADR status | Reviewed implementation evidence and remaining gaps; no baseline certification inferred from this decision |

## Verification and acceptance

- Apply ADR-0017 verification to each selected profile. The P0 reproduction must
  become a meaningful transport regression checking actual tool actor and forwarded
  assertion, not only middleware responses. Test default transport response mode.
- Cover backend route privileges and both sides of configuration/runtime contracts.
  Save connection/auth/security changes before inspecting the persisted connector
  ID. No unsaved privileged JWT issuance is supported. Inspection results never
  confer trust. Preserve draft/secret values and show save-first guidance.
- Verify permission revocation, endpoint changes, audience mismatch, stale policy,
  protected imports/copies and explicit no-credential forwarding to another target.
- Verify focused frontend tests and types plus private browser QA for authorized and
  unauthorized roles, credential preservation, keyboard navigation and error states.
- Run relevant integration tests for conversation and Playbook shared-client callers;
  obtain the required high-risk review and close critical/major findings before full
  completion. Record actual PASS/FAIL/BLOCKED and deployed validation gaps.

## Concrete implementation contract

The user approved the following names and contracts as one coherent design. Keep the P0 fix
independent of the control-plane migration. Do not introduce a new service class,
database namespace, table or runtime for this design.

### Persistence and policy fields

Extend the existing `integrationsConnectors` Drizzle definition and
`PgConnectorStore` / `ConnectorRow` in the connector module. The current store uses
PostgreSQL and already keeps actions, runtime auth and worker policy as structured
data; a separate trust collection would duplicate ownership.

Use two columns on the existing connector table: `mcp_security_policy` (JSONB)
and `security_revision` (positive integer). Exact SQL/schema definition remains in
the implementation migration, not in this prose. Add matching typed DTO/store
fields `mcpSecurityPolicy` and `securityRevision`.

| Policy field | Values / meaning | Default and constraints |
| --- | --- | --- |
| `version` | Policy document format, initially `1` | Backend validates known versions; separate from concurrency revision |
| `profile` | `configured`, `internal_jwt`, `public` | `configured` uses existing supported credential/connected-app configuration; it must not imply that an unavailable OAuth/workload method is implemented |
| `audience` | C1 intended recipient | Required non-empty bounded value for `internal_jwt`; absent otherwise; receiving MCP must agree |
| `actorDelegation` | `none`, `verified_user` | `none`; initial implementation permits `verified_user` only with `internal_jwt`, with actor from validated execution identity |
| `allowPrivateNetwork` | Explicit exact-destination exception | `false`; not implied by JWT/delegation; disallow metadata/link-local/unsafe targets and preserve deployment egress protection |
| `requiredPermissions` | Known platform permission identifiers checked before use/issuance/renewal | Empty list means no additional platform permission beyond authenticated connector eligibility, not unrestricted backend resources; privileged setting to prevent removing restrictions |

Do not duplicate endpoint or transport inside policy: use existing `mcpServerUrl`
and `mcpTransportType`. No secrets belong in the policy. Keep credential ownership
in existing credential/connected-app storage; public DTOs expose only safe summary
and capability/status data. Admin DTOs may expose validated policy but never keys.
The public profile must explicitly reject credential injection and user delegation;
it does not make protected platform API routes anonymous. `configured` must resolve
its required credential or fail; it cannot silently degrade to public access.

For Semantic Model, the target is `internal_jwt`, audience
`mcp-semantic-model`, `verified_user`, and an exact private-network exception where
the deployed address requires it. Select required platform permissions against the
existing semantic permissions; domain guards continue per-tool resource/role checks.
Do not infer privileges from the connector's slug or `isSystem` flag.

### RBAC and write contract

Use permission `CONNECTORS_SECURITY_MANAGE = connectors.security.manage`
in the existing authorization constants/permission registry. Grant it through the
existing role administration to intended platform security administrators, not to
every holder of `connectors.update`. Existing wildcard semantics must be explicit:
roles holding `connectors.*` or global wildcard inherently include it; inspect and
test seeded roles and the role editor during migration. No frontend-only gate.

| Operation | Required privilege / behavior |
| --- | --- |
| Read ordinary connector / own credential status | Existing read/user API rules; no new secret exposure |
| Edit metadata | Existing create/update permission; omitted security fields preserve stored policy |
| Set/change security policy | Existing create/update permission plus `connectors.security.manage` |
| Change endpoint, transport or auth routing on a privileged connector | Also security-management permission, since the change can redirect authority; mere field omission must not bypass this |
| Add/remove dynamic identity headers or raw auth overrides | Backend rejects reserved identity/auth overrides; no JSON/header route around the selected profile |
| Disable/delete connector | Existing update/delete permission may revoke availability; no privilege grant is possible. Re-enable a privileged connector also requires security-management permission |
| Export/import security | Existing `connectors.transfer_security` plus security-management permission to apply privileged grants; defaults omit grants and never activate copied trust automatically |
| Inspect a privileged configuration | Save first; use persisted connector ID and current policy, required permissions and the authenticated inspector's actor. No draft destination may obtain a signed token |

Pass a trusted caller authorization context into the existing connector service's
write/inspection entry points; service checks cover catalog/import/internal callers
as well as HTTP controllers. A body field claiming permission is never trusted.
Use an explicit narrowly scoped migration path for approved legacy promotion, not a
general `skipAuthorization` option.

Extend existing admin create/update DTOs rather than adding a second policy API.
Require `expectedSecurityRevision` for updates that change the security policy or
effective destination/auth configuration. Apply destination, credentials-routing
and policy changes atomically with a conditional store update, returning conflict
on a stale revision. Metadata-only changes must not overwrite security. Disable,
enable and other binding-affecting changes increment the revision atomically too;
no snapshot used to grant credentials may ignore such a change. New connectors
start with safe defaults; copies lose privileged grants pending explicit setup.

### Runtime policy and token lifecycle

Keep policy normalization/resolution as typed helpers in the existing connector
module and orchestration in its current services; no new independent policy service
is proposed. Runtime binding, admin inspection, user issuance and internal renewal
load the current raw connector row, validate the selected profile and destination,
check active account/connector and `requiredPermissions`, then resolve credentials.
Use the same check order for all paths. Fail closed on auth resolution errors for
protected profiles rather than returning an unauthenticated binding.

C1 JWTs retain ADR-0017's five-minute maximum and include backend-controlled
connector ID and security revision in addition to actor/issuer/audience/time claims.
Validate these bindings in renewal. The backend semantic actor guard checks the
current connector revision as well as its trusted expected audience before domain
operations; never select the expected audience from the unverified JWT itself.
Use an uncached current-policy lookup initially; optimization needs a separately
verified invalidation design. Define a request already authorized at the check
boundary as in flight; no claim that a policy change cancels it automatically.

Rename, rather than add alongside, the existing issuer to `McpJwtService`. Load
trusted key material independently of feature-name lists; require signing key/issuer
when C1 is enabled and reject activating a C1 connector if signer configuration is
unavailable. UI-created C1 policies must work without restarting solely to discover
a new connector. Deployment settings continue to own signing material and each
MCP's verifier; database rows do not supply signing keys or arbitrary key URLs.

Change internal renewal from the current supplied `userId` trust model to proof of
the existing actor: require an authenticated scoped renewal principal plus the
current valid signed assertion. Derive `sub` from that assertion, match connector,
revision and audience, and recheck account/permissions before minting. The caller
cannot choose a new subject or destination. The authenticated user route bootstraps
only its own identity. Renew before expiry; an expired assertion requires fresh
bootstrap from authenticated application execution, not a secret-plus-user-ID fallback.

The runtime is the renewing workload, not the receiving MCP. Use an
`adk-runtime` principal to the existing principal guard/config ownership, using a
dedicated `ADK_RUNTIME_MCP_RENEWAL_TOKEN` and permission limited to this renewal
operation. Remove semantic-model-mcp renewal authority after migration while keeping
its separate backend-tool-call authority. Never reuse app-runtime or the legacy
internal secret. This is the approved principal/config contract, not a new service.
Long-running idle execution must explicitly handle rebootstrap;
do not silently extend an unproven identity indefinitely.

For existing external MCPs, already-sent credentials obey their own revocation
mechanisms. Policy changes prevent further platform attachment/issuance; prompt
inbound rejection at a managed MCP additionally requires policy-aware verification
or another revocation mechanism. Document the residual validity window at that
boundary; stateless transport alone does not revoke tokens.

### Neutral Python package and consumers

Use `yellowstorm-adk/src/mcp/` with `__init__.py` and `jwt_auth.py` as the
neutral package. Inspection found no `src/common/` package; creating a two-level
common namespace adds no benefit here. This replaces the earlier tentative
`src/common/mcp/` location, without introducing a new runtime or deployment unit.

Move the existing implementation, then update imports/tests in
`flow_engine/tools/langchain_factory.py`,
`smart_rag/tools/utilities/connector_tools.py` and the helper's own relative imports.
The companion agent reuses connector tools indirectly; verify its callers rather
than duplicating another transport. Search all source/tests/packaging references
before deleting the old package. Preserve one implementation and test supported
external bearer/SSE behavior as well as internal JWT streamable HTTP.

Extend runtime auth metadata with the current assertion and revision as necessary;
do not trust editable `userId` metadata. Keep these credentials server-side. An old
worker that cannot prove renewal must fail clearly and require restart/rebinding,
not fall back to legacy unbounded renewal.

### Simplified editor contract

Keep the existing `CreateEditConnectorDialog` in the admin module; add only local
components/helpers as needed. No new frontend module is proposed. Use one draft and
one save payload so collapsed sections do not erase persisted settings.

| Visible choice | Fields/status shown | Backend mapping |
| --- | --- | --- |
| Saved credential | Credential configured/missing; explicit replace/remove | `configured` plus existing credential source; bearer is the simple path, custom headers remain Advanced |
| Connected account | App selection and own connection status | `configured` plus existing connected-app source; do not claim support for arbitrary MCP OAuth discovery |
| YellowStorm user delegation | Readable actor/delegation summary; audience under authorized security details | `internal_jwt` + `verified_user`; no manually stored access token |
| Public / no authentication | Explicit public-access explanation | `public`, no credential or identity injection |

Primary layout: connection name/endpoint/transport, Authentication method, then
Save and Test connection. Testing uses the saved connector ID after connection,
authentication and security changes are saved, never direct browser calls or draft
JWT issuance. Under Advanced place existing JSON,
custom headers, transport-specific overrides and authorized trust details. Keep
branding/actions in secondary sections. Unsupported stdio/runtime modes remain
unavailable under existing restrictions; these UI options do not implement every
ADR-0017 profile at once. Legacy configurations that cannot be represented simply
show a read-only summary and preserved Advanced values instead of destructive reset.

Use a single credential status with actions rather than two simultaneous toggles.
Conflict/error handling keeps the draft and requires reloading/reconciling current
policy. EN/FR copy, keyboard navigation and role-based browser checks are required.

### Migration, acceptance and approval boundary

Proposed sequence: P0 isolation/cleanup tests; approved package extraction; policy
columns/DTOs/RBAC with default-deny trust; issuer/renewal consumers; editor; explicit
legacy migration and old-path removal. Feature delivery must not depend on declaring
Semantic Model a certified reference. Update contract mirrors and bootstrap/packaging
where actual source inspection finds affected consumers.

Legacy mapping must be an explicit administrator-reviewed migration using each
connector's actual destination and intended audience. Surface conflicts instead of
granting every same-URL connector trust; require explicit approved connector IDs.
No SQL default or runtime URL match may promote an ordinary connector. Before
switching a deployment, validate both issuer/verifier and new renewal principal,
and rehearse rollback without restoring the unsafe session/renewal behavior.

Acceptance adds direct API permission tests, stale-revision races, profile-specific
credential failures, protected import/copy, URL normalization/redirect negatives,
active-account/permission revocation, same-URL untrusted connectors and renewed
assertions matching the current call. Confirm the generic extraction works for
conversation and Playbook callers. Browser QA must prove ordinary edits preserve
credentials/security and unauthorized users cannot grant trust.

The coherent named design was confirmed: existing connector-table policy columns
and revision contract; `connectors.security.manage`; scoped `adk-runtime` renewal
principal and assertion proof; `src/mcp/` extraction; existing-editor progressive
disclosure. Production rollout remains an operational action, separate from local
implementation and its checks.

## Rationale, alternatives and verification of this record

Connector-managed policy avoids duplicate configuration and hardcoded feature lists;
privileged backend controls preserve the trust boundary. Progressive disclosure
reduces editor complexity instead of appending more raw security fields. A separate
deployment registry remains a possible alternative but is not the chosen direction;
an unrestricted ordinary connector form is rejected because it can grant authority.

The initial record was a documentation-only proposal. Following user confirmation,
source changes implement the selected contract; see [backend security](../backend/security.md)
and [ADK ownership](../architecture/adk-runtime.md). Focused stateless, JWT/renewal,
policy/CAS and editor tests exist. Final security review, browser QA and deployment
validation are separate gates; this accepted decision is not a compliance certificate.

## Rollout and compatibility

Apply migration `YellowStorm/back/drizzle/0049_connector_mcp_security.sql` through
the existing operational migration process before starting the new backend. Only
the isolated test database was used for migration/CAS testing; this task does not
apply it to a live `agentstore`. Provision the same dedicated
`ADK_RUNTIME_MCP_RENEWAL_TOKEN` in backend and ADK deployment secret configuration,
and configure signer/receiving verifier independently. Restart/rebind old runtime
workers; user-ID-only renewal is intentionally incompatible and fails closed.

New rows receive no privileged grants. Explicitly configure approved connector IDs
in the UI; do not infer trust from old slugs or URL env lists. Existing shared signer
keys take precedence over the legacy semantic signer keys in a bounded compatibility
adapter. Remove legacy signer keys after deployments use shared settings and verify
no remaining consumers. URL lists no longer grant identity forwarding, tokens or
private-network exceptions. Move former ambient connector credentials to explicit
connector configuration. Already-issued tokens retain their receiving boundary's
documented validity; backend operations and renewal check current policy revisions.

Stateless cleanup must remain during rollback. Stop affected operations rather than
restoring the unsafe stateful context or broad renewal authority.
