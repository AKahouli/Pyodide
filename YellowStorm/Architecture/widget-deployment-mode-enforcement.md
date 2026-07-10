---
project: YellowStorm
type: architecture
topic: widget-deployment-mode-enforcement
status: active
updated: 2026-07-10 10:00 UTC
source_paths:
  - YellowStorm/back/src/modules/widget-chat/guards/widget-token.guard.ts
  - YellowStorm/back/src/modules/widget-chat/decorators/widget-deployment-mode.decorator.ts
  - YellowStorm/back/src/modules/widget-chat/controllers/widget-chat.controller.ts
  - YellowStorm/back/src/modules/widget-chat/controllers/agent-integration.controller.ts
  - YellowStorm/back/src/modules/agent/schemas/agent.schema.ts
  - YellowStorm/back/src/modules/agent/agent.service.ts
tags:
  - yellowstorm
  - architecture
  - guard
  - widget
  - backend
---

# Widget Deployment Mode Enforcement

## Purpose
Authentication- and authorization-gate for public widget chat routes. The `WidgetTokenGuard` performs token validation, origin allowlist checking, expiry enforcement, and crucially — **deployment mode gating** via the `WidgetDeploymentMode` decorator. This prevents embed-mode tokens from being used on REST integration routes and vice versa.

## Architecture

```
Request → WidgetTokenGuard → token extraction (Bearer / query)
                            → SHA-256 hash → DB lookup (widget_tokens)
                            → expiry check
                            → origin allowlist
                            → agent existence + isActive
                            → deployment mode check
                            → attach to request (widgetTokenHash, widgetAgentId, widgetAgent)
```

## The Deployment Mode Decorator

```typescript
// decorator/widget-deployment-mode.decorator.ts
export type WidgetDeploymentMode = 'embed' | 'rest';
export const WIDGET_DEPLOYMENT_MODE_KEY = 'widgetDeploymentMode';

export const WidgetDeploymentMode = (mode: WidgetDeploymentMode) =>
  SetMetadata(WIDGET_DEPLOYMENT_MODE_KEY, mode);
```

Two modes:
- `'embed'` — Applied to all `/api/v1/widget/*` public routes (`chat`, `session`, `stream`, `config`, `citation-url`, `reset`)
- `'rest'` — Applied to `POST /api/v1/integrations/agents/:agentId/messages`

## Enforcement Logic (`widget-token.guard.ts`)

```typescript
const mode = this.reflector.getAllAndOverride<WidgetDeploymentMode>(
  WIDGET_DEPLOYMENT_MODE_KEY,
  [handler, classRef]
);

// Fallback: infer from path if no decorator
const inferred: WidgetDeploymentMode = req.path.startsWith('/api/v1/integrations/')
  ? 'rest' : 'embed';
const effectiveMode: WidgetDeploymentMode = mode ?? inferred;

const deploymentSettings = agent.deploymentSettings as
  { embedEnabled?: boolean; restEnabled?: boolean } | undefined;

if (effectiveMode === 'embed' && deploymentSettings?.embedEnabled !== true) {
  throw new ForbiddenException('WIDGET_EMBED_DISABLED');
}
if (effectiveMode === 'rest' && deploymentSettings?.restEnabled !== true) {
  throw new ForbiddenException('WIDGET_REST_DISABLED');
}
```

Key details:
- Reads metadata from both route handler (method) and class level via `getAllAndOverride`
- Falls back to path-based inference if no decorator exists (forward-compatible)
- Both flags default to `false` on the agent schema
- Migration sets both `true` for agents with pre-existing active tokens

## Agent Schema Integration

`AgentDeploymentSettings` on the agent document:
```typescript
{
  embedEnabled: boolean;       // default false
  restEnabled: boolean;        // default false
  widget?: Record<string, unknown>;  // arbitrary, normalized on read
}
```

Normalized on every API response via `normalizeDeploymentSettings()` in `agent.service.ts`, which calls `normalizeWidgetSettings()` from `widget-default-settings.ts`.

## Rate Limiting

All public widget routes have rate limits applied separately:
- `/widget/chat`, `/widget/session`, `/widget/session/reset`: 30 req/min per token
- `/widget/config`: 60 req/min per token
- `/widget/citation-url`: 10 req/min per token
- `/integrations/agents/:agentId/messages`: 60 req/min per token

## Data Flow for Config Endpoint

```
Browser snippet ← GET /widget/config?token=xxx
  → WidgetTokenGuard validates token, checks embedEnabled
  → widgetChatService.getPublicConfig(agent)
    → normalizeWidgetSettings(agent.deploymentSettings?.widget)
    → returns { agentId, widget: AgentWidgetSettings }
  → Snippet applies CSS variables, renders widget
```

## Related Notes
- [[webchat-widget]] — Main feature note (routes, DTOs, schemas, snippet)
- [[ADR-001-widget-deployment-mode-backfill]] — ADR for the backfill migration