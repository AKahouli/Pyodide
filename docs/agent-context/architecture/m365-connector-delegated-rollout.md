# M365 Teams/Outlook delegated-authority rollout

Date: 2026-10-20. Scope: production `teams` and `outlook` connectors and the
`mcp/mcp-team` / `mcp/mcp-outlook` servers. Local end-to-end verification is
complete; production migration has not been performed.

## Target contract

Both servers and connector rows move from the ambient single-tenant model
(`M365_ACCESS_TOKEN`, `configured` profile, SSE) to the SharePoint posture
(ADR-0017 provider authority, ADR-0026 combined assertion + provider credential,
ADR-0018/0026 stateless transport):

- Ingress `Authorization: Bearer <backend actor assertion>`, audience
  `mcp-team` or `mcp-outlook`, issued by the backend.
- Per-request provider credential `X-M365-Access-Token: <raw delegated Graph
  token>` (no `Bearer ` prefix at this layer; the MCP adds it for Graph).
- No `M365_ACCESS_TOKEN` in the deployment environment or secret store.
- `streamable-http` with `stateless_http=True`; connector URL path `/mcp`.
- Missing, duplicated, blank, or assertion-reusing provider tokens fail closed
  with `403 provider_credential_required`; a wrong audience fails with `401`.

## Preconditions

- Azure app registration has the delegated scopes used by each server:
  Teams `Chat.ReadWrite`, `Team.ReadBasic.All`, `ChannelMessage.Send`;
  Outlook `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `User.Read.All`.
- Each connector's connected app still resolves a token for a real signed-in
  user (Connect Apps shows Microsoft 365 connected).
- The backend signer can mint assertions for the connector audience
  (`MCP_JWT_*` / `SEMANTIC_MODEL_MCP_JWT_*` pair configured and validated at
  startup).
- The receiver mounts the backend public key (`MCP_JWT_PUBLIC_KEY`) and sets
  `MCP_JWT_ISSUER`, `MCP_JWT_AUDIENCE`, `M365_TOKEN_HEADER=x-m365-access-token`.
- TLS: production keeps `allowInsecureHttp: false`; the public MCP URLs must be
  `https://…/mcp`.

## Migration and deploy order (one coordinated window)

The hardened servers reject the old `configured`/SSE call shape, so the server
deploy and the connector-row migration must not be separated by user traffic.

1. Build both images from this branch. Confirm each container starts with
   `streamable-http` and exposes `/mcp` (match the deployed port: Teams 8003,
   Outlook 8002 unless the deployment overrides it).
2. Publish the new images to a standby/blue slot without switching traffic.
3. Update both connector rows (admin UI/API preferred; the policy validator
   must accept the result):
   - `mcp_transport_type = streamable_http`
   - `mcp_server_url = https://mcp-teams.yellowmind.ai/mcp` /
     `https://mcp-outlook.yellowmind.ai/mcp`
   - `runtime_auth_config = {"strategy":"http_header_bearer","headerName":"X-M365-Access-Token","headerPrefix":""}`
   - `mcp_security_policy = {"version":1,"profile":"internal_jwt","audience":"mcp-team"|"mcp-outlook","actorDelegation":"verified_user","allowPrivateNetwork":true,"allowInsecureHttp":false,"requiredPermissions":[]}`
   - `dynamic_headers = []` (actor identity comes from the assertion subject)
   - bump `security_revision` so clients drop stale bindings
4. Switch traffic to the new images in the same change window.
5. Remove `M365_ACCESS_TOKEN` from the deployment env/secret store and restart
   the MCP containers so no ambient credential remains.
6. Keep the previous image digest and the previous connector-row values until
   step 7 passes.

## Verification gates

For each server, before declaring ready:

- `GET /health/live` returns 200.
- Gate matrix with a freshly minted assertion: both headers `200`; missing
  provider header `403`; provider header equal to the assertion `403`; wrong
  audience `401`.
- One real signed-in user call per server through the agent-bound connector
  (Teams `list_joined_teams`, Outlook `search_emails`) returns data with no
  `403 provider_credential_required` and no 401.
- Two different users return their own data (per-user authority, not a shared
  mailbox/team view).
- `security_revision` observed by the running clients matches the new row and
  no stale assertion renewal loop appears.

## Rollback

Redeploy the previous images (which still read `M365_ACCESS_TOKEN`) and restore
the previous connector rows (`configured`, SSE URL, `Authorization`/`Bearer `,
`actorDelegation: none`). Do not delete the old ambient token secret until
verification passes. Rolling back only one side is not supported: the hardened
receiver rejects ambient-only calls and the old receiver ignores the provider
header.

## Known non-goals / follow-ups

- The per-message connector picker is GitHub-repository-specific; MCP connectors
  are attached through an agent. The `GET /connectors/repositories?appKey=microsoft`
  500 is a pre-existing UI mismatch, not part of this change.
- Per-server copies of `auth.py`/`graph_helpers.py` are intentional for now; a
  shared package would need architecture change-control approval.
