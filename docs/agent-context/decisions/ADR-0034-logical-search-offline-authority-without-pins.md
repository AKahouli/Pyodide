---
id: ADR-0034
status: proposed
scope: logical-search-receiver-deployment-pins
proposed_at: 2026-10-20
---

# Logical Search offline authority without connector deployment pins

User explicitly approved a dedicated `mcp-logical-search` audience and removal of
receiver-side connector/revision pins on 2026-10-20. This proposed record documents
that implementation direction, replacing only ADR-0031's receiver pinning and
revision-based deployment revocation clauses. Accepted historical records remain
unchanged. ADR-0032 scope bounds and the JWT-only direction in ADR-0033 remain.

## Contract

- Receiver trust configuration contains the public verification key, issuer and
  dedicated audience. No fixed connector ID or revision is configured there.
- The backend still explicitly opts in the connector and checks current policy,
  actor access and revision during issuance/renewal. Signed `connectorId` and
  `securityRevision` claims remain required and structurally valid, but are not
  compared with receiver deployment constants.
- Receiver independently verifies RS256 signature, issuer, intended audience,
  subject, nonempty token identifier, issued/expiry times and lifetime at most
  300 seconds, plus canonical bounded unique workspace IDs and read permission.
  Requested workspaces may only narrow signed authority. No authorization network
  calls or dynamic key downloads are introduced.
- Issuer scope lifetime defaults to 180 seconds (configurable 1..300). Disabling
  a connector, changing permissions or revising policy does not revoke an already
  issued token at the receiver before expiry. Renewal reloads current authority.
  Immediate distributed revocation is deliberately not provided. Key rotation is
  a coordinated global trust change, not a connector-specific revoke operation.
- Dedicated audience separates this receiver from a future `mcp-platform`
  deployment, even if both trust the same issuer/key. Do not accept an audience
  merely because it is present in a supplied token.

## Migration

Update Logical Search connector policy and receiver expected audience together to
`mcp-logical-search`; renew/rebind existing executions. Keep native search bound
to that opted-in connector. Remove receiver connector/revision pins and redundant
mode/environment examples. Do not change running policy or restart a shared
receiver independently of its issuing clients. Verify both positive workspace
subsets and wrong audience/issuer, malformed claims, expiry and scope rejection.
Implementation checks do not establish live migration qualification.
