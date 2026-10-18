---
feature_doc_schema: 1
feature_id: auth-stack
---

# Authentication and authorization

## Evidence and scope

- Source revision/branch: `2d441a7cc` / `baseline/semantic-model-001`; inspected 2026-10-14.
- Verification level: backend auth and authorization READMEs, auth-provider README, source inspection only; no tests executed.
- Scope: Backend authentication, configurable OAuth providers and RBAC, plus frontend auth module. Frontend details and exact auth-provider UI integration were not inspected.

## Purpose and workflows

Current-role read optimization (2026-10-17): `AuthorizationService.getUserRoles`
uses `PgRoleStore.findActiveForUser`, one fresh joined SELECT over existing users,
ordered memberships and active roles. It replaces four serial hydration queries,
preserving user existence, membership-position order, full role response mapping
and the ambient transaction context. This current-role read is not cached. Account
approval, connector destination checks, permission resolution and repeated MCP
authorization boundaries remain unchanged. Real PostgreSQL regressions verify
one-query execution, revocation/reactivation, current permissions, deleted users
and transaction rollback; service and MCP JWT tests cover the consuming boundary.

The auth stack establishes user sessions and OAuth sign-in/linking, then applies role/permission checks to protected operations. Detailed behavior references are maintained in [auth README](../../../YellowStorm/back/src/modules/auth/README.md), [auth-provider README](../../../YellowStorm/back/src/modules/auth-provider/README.md) and [authorization README](../../../YellowStorm/back/src/modules/authorization/README.md).

| Workflow | Implemented behavior and source |
| --- | --- |
| Sign in and manage session | JWT access plus refresh-cookie/session flow; backend auth README and [frontend auth module](../../../YellowStorm/front/src/modules/auth/) |
| External provider login/link | OAuth provider configuration, state/PKCE and provider links; [auth-provider README](../../../YellowStorm/back/src/modules/auth-provider/README.md) |
| Authorize actions | Role permissions are attached to JWT and checked by authorization guards; [authorization README](../../../YellowStorm/back/src/modules/authorization/README.md) |

## Ownership and boundaries

- Backend modules: `YellowStorm/back/src/modules/auth/`, `auth-provider/`, `authorization/`; frontend: `YellowStorm/front/src/modules/auth/`.
- ADK/MCP auth surface: not established in this batch; callers use existing backend auth/contracts as appropriate.
- Persistence: PostgreSQL/Drizzle identity sessions and OAuth-provider state/link data; RBAC role/audit data uses PostgreSQL. See module READMEs and [persistence context](../backend/persistence.md).
- Contracts: REST `/api/v1/auth/**`, `/api/v1/auth/providers/**`, and `/api/v1/admin/**` role/provider routes. Request DTOs, guards and schemas are executable owners; see linked READMEs and [API contracts](../backend/api-contracts.md).

## Reuse map

| Change | Existing owner to extend |
| --- | --- |
| Login, refresh, session lifecycle | [backend auth README](../../../YellowStorm/back/src/modules/auth/README.md), [frontend auth module](../../../YellowStorm/front/src/modules/auth/) |
| OAuth provider flow/account links | [auth-provider README](../../../YellowStorm/back/src/modules/auth-provider/README.md) |
| Permissions, roles and audit | [authorization README](../../../YellowStorm/back/src/modules/authorization/README.md) |

## Constraints and limitations

- Auth README documents HttpOnly refresh cookies and session-backed token revocation; do not move credentials into browser storage.
- Cross-tab refresh now hands off a rotated access token through the existing
  transient same-origin BroadcastChannel before SSE reconnect. This fixes stale
  tabs repeatedly rotating the shared cookie and revoking each other's session.
  Current-principal/freshness/auth-generation checks and HMR cleanup apply; no
  token is persisted. Server JWT verification, rotation and revocation are
  unchanged. See proposed [ADR-0029](../decisions/ADR-0029-cross-tab-access-token-handoff.md).
- Permission and provider route details are linked, not duplicated. The phase 4
  client refresh/recovery boundary has 22 passing tests across four focused suites
  plus frontend typecheck; broader provider routes are outside that change.
- No historical rationale beyond reviewed decisions is inferred; check [baseline gaps](../architecture/baseline-gaps.md) for unresolved rationale.

## Focused verification

The earlier baseline did not execute provider/backend suites. Phase 4 refresh
client results are recorded above; commands below are package entry points for
other auth changes, not claims that their broader suites passed.

| Area | Command, working directory and evidence/gap |
| --- | --- |
| Frontend auth | From `YellowStorm/front`: `npm test -- src/modules/auth/`; exact test paths not inspected |
| Backend auth/provider/RBAC | From `YellowStorm/back`: `npm test -- auth auth-provider authorization`; exact test paths not inspected |
| Boundary/security | Run relevant sender/receiver and auth/security checks for changed routes; this batch did not enumerate integration tests |

## Related context and maintenance

- [Feature index](README.md), [security](../backend/security.md), [API contracts](../backend/api-contracts.md), [persistence](../backend/persistence.md), [change control](../architecture/change-control.md).
- Update with verified source/tests when auth flows, identity persistence, provider contracts or permission enforcement changes.
