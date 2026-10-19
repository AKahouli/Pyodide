# ADR-0002: Dynamic workspace scope from the trusted header

- Status: Accepted
- Date: 2026-10-16
- Supersedes: [ADR-0001](0001-identity-bound-workspace-authorization.md)
- Decision: User confirmed dynamic workspaces and requested header-based scope.
- Implementation: Applied; deployment/gateway verification remains external.

## Context

Workspace IDs are created dynamically. A static configuration allowlist and
credential-to-workspace mapping would require configuration changes/restarts as
workspaces change. They do not fit the application's authorization workflow.
Workspace selection must remain outside LLM-generated arguments to prevent a
prompt injection from expanding the scope supplied by trusted application code.

## Decision

1. Retain the existing service bearer authentication. Remove static workspace
   settings, their validators, and additional credential/workspace mappings.
2. Use `Workspace-Id` from each authenticated request as its dynamic scope.
   New workspace IDs require no configuration changes or restart.
3. Require the header for MCP document operations and data-bearing HTTP routes.
   MCP initialization and schema discovery require bearer authentication without
   workspace scope; each later document operation supplies its current header.
   Check exact tool/body
   workspace IDs against it, reject mixed out-of-scope batches before work, and
   filter filename-only discovery to it. Preserve SQL scoping and request-context
   cleanup. Comma separation is supported in the header, not in literal tool IDs.
4. The trusted backend/gateway authenticates users, checks their workspace
   membership dynamically, strips untrusted scope headers, and injects the
   permitted scope. Keep the bearer secret and header construction outside the
   LLM, and prevent untrusted clients from bypassing this backend.

## Alternatives and consequences

- Static workspace lists were rejected because they constrain dynamic workspaces.
- Signed scope claims or a service-side entitlement lookup are future integration
  options if the deployment cannot establish the trusted-backend boundary.
- Header enforcement limits model/tool access to the supplied scope. A header
  and shared bearer key alone do not independently establish user membership;
  verification of the backend and deployment is still required for audit finding 01.
- The other security controls remain unchanged. No retrieval/ranking algorithms,
  model payloads, citation formats, or ingestion behavior change with this decision.

## Verification

Regression tests cover new workspace IDs without configuration, bearer rejection,
missing headers, body/tool scope expansion, exact-ID matching, and request-context
cleanup. Deployment owners must verify membership checks, header injection,
credential handling, and prevention of direct backend bypass.

See [security configuration](../security-configuration.md) for request and rollout details.
