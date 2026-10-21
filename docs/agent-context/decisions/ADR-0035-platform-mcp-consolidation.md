---
id: ADR-0035
status: proposed
scope: yellowstorm-platform-mcp-consolidation
proposed_at: 2026-10-20
---

# YellowStorm Platform MCP consolidation

## Intent and approval

The user approved the named design "one modular YellowStorm Platform MCP, backed
by the existing domain services" (2026-10-20) to minimize deployment
configuration for first-party agent tooling. `mcp/mcp-playbook`,
`mcp/mcp-agent` and `mcp/mcp-semantic-model` consolidate into `mcp/mcp-platform`
with one audience (`mcp-platform`), one deployment and one connector. This
proposed record documents the approved direction; historical accepted records
remain unchanged.

## Contract

- One FastMCP server mounts independent tool modules (Playbook, Agent/Team,
  Semantic). Each module exposes `INSTRUCTIONS` and `register(mcp, settings)`;
  tool names, prefixes, inputs/outputs and stable error codes are preserved per
  module (`playbook_*`, agent/team `AGENT_*`/`TEAM_*`, `SEMANTIC_*`).
- Shared foundation: JWT-only identity (ADR-0033: RS256, issuer, single
  `mcp-platform` audience, fail-closed, no static credentials), one backend HTTP
  client with assertion forwarding, timeouts, response caps and error
  translation, request-local actor context, health routes, stateless
  streamable-HTTP transport.
- Deployment configuration collapses to: `YELLOWSTORM_BACKEND_URL`,
  `MCP_JWT_PUBLIC_KEY_FILE`, `MCP_JWT_ISSUER`, `MCP_JWT_AUDIENCE=mcp-platform`,
  transport/host/port plus per-module feature knobs. No per-server duplicated
  auth/ingress settings.
- The backend keeps route-owned audience fences and accepts the legacy
  audiences plus `mcp-platform` during the migration; connector
  policy/revision, verified-user delegation, actor permissions and resource
  authorization are unchanged. Audit attribution names the verified audience
  principal.
- Cross-feature flows (for example: query a semantic model, create a specialist
  agent, then generate a Playbook) are orchestrated by the AI agent through one
  connector; per-agent action bindings still scope tool visibility. There is no
  module-to-module or MCP-to-MCP call path.
- Yellowmind-conversation-specific Playbook operations (Platform Copilot
  conversation linkage) remain distinct from generally usable platform tools;
  consolidation does not relax those checks.
- Logical Search (`C:\prog\mcp-server-logical-search`) and external-provider
  MCPs (M365, GitHub, â€¦) stay separate deployments.

## Migration and retirement

1. Land `mcp/mcp-platform` with all three modules and focused suites.
2. Wire a connector (local test first: `internal_jwt`, audience
   `mcp-platform`, `verified_user`, `streamable_http`) and bind it to a test
   agent; verify real cross-feature flows end to end.
3. Migrate production agents' bindings to the platform connector.
4. Retire the three old deployments/connector rows in a coordinated window only
   after verification; backend legacy-audience acceptance is removed in the
   same window.
