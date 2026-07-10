---
project: YellowStorm
type: decision
adr: 1
topic: widget-deployment-mode-backfill
status: accepted
updated: 2026-07-10 10:00 UTC
source_paths:
  - YellowStorm/back/scripts/migrations/2026-07-09-backfill-widget-deployment-modes.ts
  - YellowStorm/back/src/modules/agent/schemas/agent.schema.ts
  - YellowStorm/back/src/modules/widget-chat/guards/widget-token.guard.ts
tags:
  - yellowstorm
  - decision
  - widget
  - migration
  - backward-compatibility
---

# ADR-001: Widget Deployment Mode Backfill Migration

## Status
Accepted

## Context
Widget deployment mode enforcement (embed vs rest) was added to `WidgetTokenGuard`. The guard checks `deploymentSettings.embedEnabled` / `deploymentSettings.restEnabled` on the agent document. Both flags default to `false`. 

Existing agents with active widget tokens (created before this feature) had no `embedEnabled` or `restEnabled` set. Without a migration, those tokens would fail the deployment mode check after deployment, breaking all existing public embeds and REST integrations.

## Decision
Write a one-time migration (`2026-07-09-backfill-widget-deployment-modes.ts`) that:
1. Finds all agents with at least one active, non-expired widget token
2. Sets BOTH `deploymentSettings.embedEnabled` and `deploymentSettings.restEnabled` to `true` on those agents

The migration runs once during deployment and is idempotent (running again only updates agents that still have active tokens).

## Rationale
- **Backward compatibility:** Existing customers' embeds and integrations continue working without manual reconfiguration
- **Both flags set to true:** We cannot distinguish whether a token was created for embed vs REST, and agents could have tokens for both purposes. Setting both flags preserves all existing usage patterns
- **No data loss risk:** The migration only *sets* flags (uses `$set`, not `$unset` or destructive operations). Agents that already have deployment settings are updated correctly regardless of prior state
- **One-time, no runtime cost:** After the migration, new agents default to `false` for both flags (explicit admin opt-in). No ongoing overhead

## Alternatives Considered
- **Manual per-agent update:** Impractical for organizations with hundreds of agents; high risk of customer breakage.
- **Default both flags to `true` in schema:** Would make new agents publicly accessible without admin action — security regression.
- **Infer mode from token usage history:** Requires audit log of which endpoints each token hit; no such log exists.
- **Skip migration, make guard log-only initially:** Would require a second deployment to actually enforce; delays the feature.

## Consequences
- Agents with active tokens implicitly allow both embed and REST after migration, regardless of admin intent. Admins should review deployment settings post-migration and disable modes they don't intend to expose.
- New agents (created after migration) default to both flags `false` — explicit admin opt-in required.
- The migration must run before or alongside the deployment that includes `WidgetTokenGuard` deployment mode enforcement. If the guard deploys before the migration, existing tokens will be rejected.

## Related Notes
- [[widget-deployment-mode-enforcement]] — The guard architecture that reads these flags
- [[webchat-widget]] — Main feature note