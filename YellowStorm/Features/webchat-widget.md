---
project: YellowStorm
type: feature
slug: webchat-widget
status: active
updated: 2026-07-10 20:00 UTC
source_paths:
  - YellowStorm/back/src/modules/widget-chat/
  - YellowStorm/back/src/modules/agent/agent.service.ts
  - YellowStorm/back/src/modules/agent/interfaces/agent.interface.ts
  - YellowStorm/back/src/modules/agent/dto/create-agent.dto.ts
  - YellowStorm/back/src/modules/agent/constants/widget-default-settings.ts
  - YellowStorm/back/scripts/migrations/2026-07-09-backfill-widget-deployment-modes.ts
  - YellowStorm/front/src/modules/agent/components/AgentDeploymentSection.tsx
  - YellowStorm/front/src/modules/agent/components/AgentFormSchema.ts
  - YellowStorm/front/src/modules/agent/components/deployment/
  - YellowStorm/front/src/modules/agent/constants/widget-template.ts
  - YellowStorm/front/src/modules/agent/constants/widget-template.spec.ts
  - YellowStorm/front/src/modules/agent/constants/widget-styles.ts
  - YellowStorm/front/src/modules/agent/constants/widget-markdown.ts
  - YellowStorm/front/src/modules/agent/constants/widget-markdown.spec.ts
  - YellowStorm/front/src/modules/agent/constants/widget-default-settings.ts
  - YellowStorm/front/src/modules/agent/constants/widget-theme-presets.ts
  - YellowStorm/front/src/modules/agent/types.ts
tags:
  - yellowstorm
  - feature/webchat-widget
  - backend
  - frontend
  - embed
  - shadow-dom
  - deployment
---

# Webchat Widget

## Agent Quick Context
- **Entry points:** Backend `widget-chat.module.ts`, frontend `AgentDeploymentSection.tsx` (deployment tab), `widget-template.ts` (snippet generator), `widget-markdown.ts` (TS reference mirror of runtime markdown renderer).
- **Runtime flow:** Browser loads embed snippet → `buildClientContext()` reads browser env → fetches `GET /api/v1/widget/config?token=<token>` (returns `{ agentId, widget }`) → applies CSS variables from theme preset → renders widget UI → user sends message → `POST /api/v1/widget/chat` with `{ message, visitorId, clientContext }` → backend creates/gets session → gRPC stream → SSE via `/api/v1/widget/stream`.
- **Contracts:** `WidgetClientContextDto`, `WidgetSendMessageDto`, `WidgetCreateSessionDto` (backend); `AgentWidgetSettings` interface (shared frontend/backend); `GET /api/v1/widget/config` returns `{ agentId: string, widget: AgentWidgetSettings }`; `WidgetDeploymentMode` decorator (`'embed' | 'rest'`).
- **Invariants:** `WidgetTokenGuard` enforces deployment mode after authentication — `'embed'` routes require `deploymentSettings.embedEnabled === true`, `'rest'` routes require `restEnabled === true`. `normalizeWidgetSettings()` always returns a complete `AgentWidgetSettings` object (deep-merged with defaults). `clientContext` is normalized to trimmed non-empty strings. Geo defaults to `{ status: 'unavailable', reason: 'provider_not_configured' }`. Snippet must escape HTML/script contexts via `escapeHtml()` and `stringifyForScript()`. All `/widget/*` routes are `@Public()`, `@SkipMaintenance()`, rate-limited.
- **Pitfalls:** `google.protobuf.Struct` on gRPC must use `toGrpcStruct()` — silent drop on wire if missed. Snippet `focus()` and `mobile` detection must handle cross-browser compatibility. Reduced motion query must respect OS accessibility settings. `allowedOrigins` in `WidgetTokenGuard` is empty by default (allow all origins) — setting it restricts to exact origin match. Migration sets BOTH `embedEnabled` and `restEnabled` to `true` for existing active tokens — new tokens respect agent defaults (`false`).

## Purpose
Third-party embeddable webchat widget. Site owners embed a `<script>` snippet that renders a self-contained chat UI with customizable appearance (theme presets, custom colors, labels, suggestions, privacy notice). Supports two deployment modes: **embed** (real-time SSE streaming) and **REST** (synchronous request/response for server-side integrations). Both modes are guarded by `WidgetTokenGuard` which validates tokens, checks origin allowlists, expiry, and deployment mode permissions.

## Current Implementation

### Backend Architecture (`/modules/widget-chat/`)
4 controllers, 1 service, 1 guard:
- **`WidgetChatController`** — All `/api/v1/widget/*` public routes (session, chat, stream, config, citation-url, reset). Requires `@WidgetDeploymentMode('embed')`.
- **`AgentIntegrationController`** — `POST /api/v1/integrations/agents/:agentId/messages` (synchronous REST chat). Requires `@WidgetDeploymentMode('rest')`.
- **`AdminWidgetController`** — Admin CRUD for widget tokens (`/api/v1/admin/agents/:agentId/widget-tokens/*`).
- **`AgentWidgetTokenController`** — Agent owner CRUD for widget tokens (`/api/v1/agents/:agentId/widget-tokens/*`).
- **`WidgetChatService`** — Session management, message handling, gRPC streaming, citation URL generation, integration message processing.
- **`WidgetTokenGuard`** — Token hash lookup → expiry check → origin allowlist → agent existence → deployment mode enforcement → attach to request.

### Deployment Settings on Agent
```typescript
interface AgentDeploymentSettings {
  embedEnabled: boolean;  // default false
  restEnabled: boolean;   // default false
  widget: AgentWidgetSettings;  // normalized partial → full
}
```

`normalizeDeploymentSettings()` in `agent.service.ts` applies `normalizeWidgetSettings()` (deep-merge with `DEFAULT_WIDGET_SETTINGS`, sanitize hex colors, cap suggestions at 6, filter footer links).

### Widget Config Endpoint
`GET /api/v1/widget/config?token=<token>` — Guarded by `WidgetTokenGuard`, rate limited (60 req/min). Returns `{ agentId, widget }` with fully normalized widget settings. Used by the embed snippet on initialization to apply theme, content, labels, and behavior.

### Widget Session Schema
```typescript
{
  tokenHash: string;         // indexed
  agentId: ObjectId;         // ref Agent, indexed
  visitorId: string;         // indexed
  metadata: { ip?, userAgent?, origin? };
  clientContext: {           // normalized browser context
    pageUrl?, origin?, referrer?, locale?, timezone?
  };
  appSource: {
    channel: 'web_widget' | 'rest_api';
    appSourceName: string;
    sourceInstanceId?: string;
    origin?: string;
    pageUrl?: string;
  };
  geo: { status: 'unavailable' | 'resolved' | 'error', reason? };  // defaults unavailable
}
```
Partial unique index: `{ tokenHash, visitorId }` where `status === 'active'`.

### Frontend Deployment UI
Located under `Agent > Deployment` tab:
- **`AgentDeploymentSection.tsx`** — Full-width vertical panes (Embed + REST API), collapsed by default. Each pane expands independently via header button. Enable/disable switches remain separate controls. Generated embed snippet output and REST API spec render inside the corresponding expanded pane.
- **`WidgetSettingsPane.tsx`** — Collapsible panel with sections: Identity, Theme (6 presets + custom colors + radius + density), Content (greeting + suggestions), Labels, Privacy & Footer, Behavior toggles, Live Preview.
- **`WidgetLivePreview.tsx`** — Static preview using actual theme colors, showing launcher, header, greeting, suggestions, typing indicator.
- **`WidgetSuggestionEditor.tsx`** — Manages up to 6 suggestions with enabled/label/prompt.

### Embed Snippet (`widget-template.ts`, `widget-styles.ts`, `widget-markdown.ts`)
Self-contained JavaScript IIFE (~468 lines) that generates a one-script copy/paste snippet. The snippet:

1. **Creates a Shadow DOM host** — `document.createElement('div')` with `id="ys-widget-host"` appended to `document.body`. Attaches an open Shadow DOM via `host.attachShadow({mode:"open"})`.
2. **Appends internal DOM** — `#ys-widget-root`, inline `<style>` tag, and widget HTML all inside the shadow root.
3. **Fetches `GET /api/v1/widget/config`** on load for runtime settings and theme.
4. **Applies CSS variables** via `applyTheme()` (16 color vars, hybrid preset+custom), targeting `root.style.setProperty()` on the internal `#ys-widget-root`.
5. **Renders widget DOM** inside the shadow root (launcher → flyout → chat UI).
6. **Handles SSE streaming** via `EventSource`.
7. **Sends `clientContext`** with every message/reset (origin, referrer, locale, timezone, pageUrl).
8. **Style isolation:** `:host { all: initial; position: fixed; right: 20px; bottom: 20px; z-index: 99999; display: block; pointer-events: none; }` prevents embedding-site CSS inheritance. `#ys-widget-root * { pointer-events: auto; }` re-enables interaction on internal elements. Theme variables applied to `#ys-widget-root` — no leakage in or out.
9. **Element lookups** use `shadow.getElementById(id)` exclusively (no `document.getElementById`).
10. **Outside menu click detection** uses `event.composedPath().indexOf(host) < 0` to handle Shadow DOM event retargeting.
11. **Accessibility:** focus management, reduced-motion media query, keyboard navigation.
12. **Mobile:** responsive viewport detection, touch-friendly launcher.
13. **Security:** `escapeHtml()` (escapes `& < > " '`), `stringifyForScript()` (JSON.stringify + `\u003c` for `<`).
14. **Markdown renderer** (`_ysMd` / `_ysInlineMd` runtime JS in snippet, mirrored as `widgetMarkdown()` in TS): escape-first pipeline, supports h1-h6 with explicit `ys-md-h*` classes, fenced code blocks, unordered lists, inline code, bold/italic, and markdown links. Link hrefs allowlisted to `http:`, `https:`, `mailto:` — unsafe schemes (`javascript:`, etc.) mapped to `#` via `_ysSafeHref()`.

### Migration
`back/scripts/migrations/2026-07-09-backfill-widget-deployment-modes.ts` — Finds agents with active non-expired widget tokens, sets both `embedEnabled` and `restEnabled` to `true`. Run once during deploy to preserve existing public embeds/integrations.

## Key Files
- `YellowStorm/back/src/modules/widget-chat/` — Module, controllers, guard, service, schemas, DTOs, decorator
- `YellowStorm/back/src/modules/widget-chat/guards/widget-token.guard.ts` — Token validation + deployment mode enforcement
- `YellowStorm/back/src/modules/widget-chat/controllers/widget-chat.controller.ts` — All `/widget/*` embed routes
- `YellowStorm/back/src/modules/widget-chat/controllers/agent-integration.controller.ts` — REST integration route
- `YellowStorm/back/src/modules/widget-chat/schemas/widget-session.schema.ts` — Session with clientContext, appSource, geo
- `YellowStorm/back/src/modules/widget-chat/services/widget-chat.service.ts` — Session lifecycle, gRPC, normalization
- `YellowStorm/back/src/modules/agent/agent.service.ts` — `normalizeDeploymentSettings()`, `normalizeWidgetSettings()`
- `YellowStorm/back/src/modules/agent/interfaces/agent.interface.ts` — `AgentWidgetSettings`, `AgentDeploymentSettings`
- `YellowStorm/back/src/modules/agent/constants/widget-default-settings.ts` — Backend widget defaults + normalization
- `YellowStorm/back/scripts/migrations/2026-07-09-backfill-widget-deployment-modes.ts` — Backfill deployment flags
- `YellowStorm/front/src/modules/agent/components/AgentDeploymentSection.tsx` — Deployment tab UI
- `YellowStorm/front/src/modules/agent/components/deployment/WidgetSettingsPane.tsx` — Widget settings collapsible pane
- `YellowStorm/front/src/modules/agent/components/deployment/WidgetLivePreview.tsx` — Live theme preview
- `YellowStorm/front/src/modules/agent/components/deployment/WidgetSuggestionEditor.tsx` — Suggestion editor
- `YellowStorm/front/src/modules/agent/constants/widget-template.ts` — Embed snippet generator (Shadow DOM, styles, runtime JS)
- `YellowStorm/front/src/modules/agent/constants/widget-template.spec.ts` — Verifies valid JS output + Shadow DOM structure
- `YellowStorm/front/src/modules/agent/constants/widget-default-settings.ts` — Frontend widget defaults + merge
- `YellowStorm/front/src/modules/agent/constants/widget-theme-presets.ts` — 6 theme presets with 16 colors each
- `YellowStorm/front/src/modules/agent/constants/widget-styles.ts` — Rich component CSS (`WIDGET_RICH_STYLES`), markdown heading classes, injected into snippet
- `YellowStorm/front/src/modules/agent/constants/widget-markdown.ts` — TS reference mirror of `_ysMd` / `_ysInlineMd` runtime; escape-first, h1-h6, allowlisted http/https/mailto
- `YellowStorm/front/src/modules/agent/constants/widget-markdown.spec.ts` — Tests link handling, code, headings, HTML escape, unsafe scheme rejection
- `YellowStorm/front/src/modules/agent/types.ts` — Frontend widget type definitions

## API / Interfaces

### Public Widget Routes (Embed)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/widget/session` | Create/resume session → `{ sessionId }` |
| `POST` | `/api/v1/widget/session/reset` | Reset session → `{ sessionId }` |
| `POST` | `/api/v1/widget/chat` | Send message, returns `{ messageId, sessionId }` |
| `GET` | `/api/v1/widget/stream?token=&sessionId=` | SSE event stream |
| `GET` | `/api/v1/widget/config?token=` | Normalized widget settings |
| `POST` | `/api/v1/widget/citation-url` | Signed citation download URL |

### REST Integration Route
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/integrations/agents/:agentId/messages` | Synchronous REST chat |

### Admin/Owner Token Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/admin/agents/:agentId/widget-tokens` | Create token |
| `GET` | `/api/v1/admin/agents/:agentId/widget-tokens` | List tokens |
| `PATCH` | `/api/v1/admin/agents/:agentId/widget-tokens/:tokenId` | Update token |
| `DELETE` | `/api/v1/admin/agents/:agentId/widget-tokens/:tokenId` | Revoke token |
| (Same under `/api/v1/agents/:agentId/widget-tokens` for agent owners) |

### Key DTOs
**`WidgetClientContextDto`**: `pageUrl?` (max 2000), `origin?` (max 200), `referrer?` (max 2000), `locale?` (max 32), `timezone?` (max 80)

**`WidgetSendMessageDto`**: `message!` (max 5000), `visitorId?` (max 64), `clientContext?`

**`WidgetCreateSessionDto`**: `visitorId!` (max 64), `clientContext?`

### Key Interfaces
**`AgentWidgetSettings`**: `version`, `appSourceName`, `identity` (orgName, title, subtitle, avatar), `launcher` (label, variant, position, badges, tooltip), `theme` (preset, customColors, radius, density), `content` (greeting, suggestions[], privacy, footer), `labels` (all widget UI strings), `behavior` (defaultOpen, persistVisitorId, allowTranscriptCopy/Download, allowNewConversation, requirePrivacyNotice)

## Design Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Two deployment modes (embed + rest) | Embed for real-time UI widgets; REST for server-side integrations (webhook, SMS, WhatsApp). Different UX and streaming patterns. | Single mode with capability flags (too complex); separate APIs per mode (cleaner contract) |
| `WidgetDeploymentMode` decorator on routes | Explicit route-deployment mapping visible at controller level; avoids runtime path-matching magic | Path-prefix-based inference (brittle, error-prone) |
| `embedEnabled`/`restEnabled` flags on agent | Admins explicitly opt in per deployment type; default off prevents unintended public exposure | Single `widgetEnabled` flag (can't distinguish modes) |
| Migration sets BOTH flags for existing tokens | Preserves backward compatibility for agents that already have active tokens — they were implicitly allowing both modes | Only set one flag (would break existing usage); manual per-agent migration (impractical) |
| `normalizeWidgetSettings()` always returns complete object | Embed snippet can depend on every field being present; no optional chaining needed in snippet | Partial settings with defaults at render time (snippet complexity, harder to debug) |
| `clientContext` sent with every message | Captures page visit context per interaction, not just session creation | Only at session creation (misses context changes during session) |
| Geo defaults to unavailable | No geo-provider dependency for widget; provider can be added later without contract change | Remove geo from schema (would need migration); make geo required (blocks widget without provider) |
| Snippet is self-contained IIFE (no external deps) | Single `<script>` tag embeddable on any page; no bundler/runtime dependency on host page | Web Component (browser support gaps); iframe (styling isolation, sizing complexity) |
| CSS vars with `applyTheme()` override | Runtime theme switching without re-rendering; all widget CSS reads `var(--ys-*)` | Compiled CSS per preset (no custom colors); inline styles (higher specificity, no responsive) |
| `escapeHtml()` + `stringifyForScript()` | Prevents XSS in user-configurable content (org name, labels, suggestions) | Trust configuration as admin-only (still risk via DB injection) |
| Shadow DOM (`attachShadow({mode:"open"})`) | Bidirectional style isolation — embedding-site CSS cannot leak into widget, widget styles cannot affect embedding page. No host page div/CSS changes required. Snippet creates its own `#ys-widget-host`. | iframe (sizing complexity, cross-origin restrictions); Web Component custom elements (browser support); direct DOM without isolation (CSS bleed in both directions) |
| `:host { all: initial; ...; pointer-events: none; }` | Resets all inherited CSS properties (inheritable properties like `color`, `font`, `line-height` are the primary leakage vectors into Shadow DOM). `pointer-events: none` on host + `pointer-events: auto` on `#ys-widget-root *` prevents widget from capturing events outside its interactive area. | CSS `all: revert` (less predictable in Shadow DOM); explicit reset of every known inheritable property (maintenance burden) |
| `event.composedPath()` for outside-menu click | Shadow DOM retargeting causes `document` click handlers to miss clicks inside the shadow root. `composedPath()` returns the full event path including the shadow host, so `e.composedPath().indexOf(host) < 0` correctly detects outside clicks. | `click` listener on `host` directly (would fire for all Shadow DOM internal clicks too) |
| Markdown renderer as both TS reference + generated runtime (`widget-markdown.ts` ↔ `_ysMd`/`_ysInlineMd` in snippet) | Single source of truth in TS keeps the generated JS renderer verifiable by tests. Both emit identical HTML structure, classes, and escaping. Must remain mirrored — any change to one must be applied to the other. | Shared template rendering (would couple markdown logic to the snippet string building); runtime-only JS renderer (no type-safe reference for testing) |
| `sanitizeLinkHref()`/`_ysSafeHref()` allowlists `http:`, `https:`, `mailto:` only | Prevents XSS via `javascript:` or other unsafe URI schemes in user-configurable markdown content. Unallowed schemes mapped to `#`. | Strip all links (breaks legitimate use); allow all schemes (XSS risk) |
| Escape-first markdown pipeline (`_ysEsc(text)` then parse) | Raw HTML in markdown source is escaped before any structure parsing, preventing injection of arbitrary HTML tags or attributes. | Parse then sanitize (risk of parser bypass); use DOMPurify (external dependency, not available in isolated snippet) |

## Known Pitfalls
- **gRPC Struct fields:** `task_metadata`, `evaluation_config`, `trigger_context` require `toGrpcStruct()` before assigning. Silent drop on wire if missed — field arrives `None` on Python side with no error.
- **`allowedOrigins` is empty = permissive:** `WidgetTokenGuard` only blocks if `allowedOrigins` is non-empty AND no match. New tokens default to empty array (all origins allowed). To restrict, explicitly set `allowedOrigins`.
- **Migration must run on deploy:** Without the backfill migration, existing active tokens will fail `WidgetTokenGuard` deployment mode check (both flags default `false`, guard rejects all modes).
- **Snippet focus management:** The snippet tries `focus()` on launcher and input. Cross-browser autofocus behavior varies (mobile Safari, embedded iframes). Test on target browsers.
- **Reduced motion:** `prefers-reduced-motion: reduce` media query must be respected in all animations; snippet applies it via `matchMedia`.
- **Snippet localization:** All user-facing strings come from `AgentWidgetSettings.labels` — the snippet has no i18n layer. Settings must be configured per locale by the agent admin.
- **`allowedOrigins` uses strict URL origin comparison:** Protocol and port must match exactly. `http://example.com` ≠ `https://example.com`. Wildcards not supported.
- **`normalizeClientContext()` extracts trimmed non-empty strings only:** If a browser sends empty strings for `origin` or `referrer`, they are omitted from `clientContext`. Session `appSource.origin` falls back to HTTP `Origin` header.
- **Geo provider dependency avoided:** If geo provider is added later, session geo field must be updated separately — the current `unavailable` default is not a fallback hook.
- **Shadow DOM `pointer-events` cascade:** `:host { pointer-events: none; }` on the host + `#ys-widget-root * { pointer-events: auto; }` on children means wrapper/ghost elements inside the shadow root that are not descendants of `#ys-widget-root` won't receive events. Always append interactive content inside `#ys-widget-root`.
- **`event.composedPath()` browser support:** `composedPath()` is widely supported in modern browsers but was added in Shadow DOM v1. Verify on legacy browsers if support is needed. The fallback behavior (no composedPath) would make the outside-menu click detection unreliable.
- **TS ↔ runtime markdown mirroring:** `widget-markdown.ts` must stay byte-level identical in output to `_ysMd()`/`_ysInlineMd()` in the generated snippet. Any change to one requires updating the other. The spec tests both paths separately — run `widget-markdown.spec.ts` and `widget-template.spec.ts` together after changes.
- **`#ys-widget-host` element in `document.body`:** The snippet creates a new `div#ys-widget-host` element unconditionally. If the embedding page has CSS that targets `div` children of `body` generically, the Shadow DOM `:host { all: initial; }` resets it, but the host element itself remains visible to embedding-site `querySelector`. Do not rely on the host's absence for feature detection.

## Recent Changes
### 2026-07-10 20:00 UTC
- **Changed:** Embed snippet (`buildWidgetSnippet()`) rewritten to use Shadow DOM for full bidirectional style isolation. Generated snippet now creates `#ys-widget-host` div→`attachShadow({mode:"open"})`→appends internal `#ys-widget-root`, inline `<style>`, and widget HTML within shadow root. `:host { all: initial; ...; pointer-events: none; }` + `#ys-widget-root * { pointer-events: auto; }` prevents CSS leakage in/out. Element lookups switched from `document.getElementById` to `shadow.getElementById`. Outside menu click detection uses `event.composedPath()` for Shadow DOM retargeting. Theme variables applied to internal `#ys-widget-root` (no embedding-site div/CSS changes required). Markdown renderer `widget-markdown.ts` (TS reference) mirrors generated `_ysMd`/`_ysInlineMd` runtime — escape-first, h1-h6 with explicit `ys-md-h*` classes, allowlists `http:`/`https:`/`mailto:` hrefs, unsafe schemes mapped to `#`. Both must remain mirrored.
- **Why:** Previous snippet appended to `document.body` directly, leaking styles bidirectionally — embedding-site CSS could corrupt widget appearance, and widget styles could affect the host page. Shadow DOM provides native browser style isolation without iframe complexity or external dependencies.
- **Impact:** `widget-template.ts`, `widget-template.spec.ts`, `widget-styles.ts`, `widget-markdown.ts`, `widget-markdown.spec.ts` (frontend). Focused Vitest 7 pass; frontend build pass; frontend QA PASS against hostile CSS desktop/mobile; reviewer PASS after resolving unsafe link protocol finding.

### 2026-07-10 10:00 UTC
- **Changed:** Added `deploymentSettings.widget` normalization pipeline — `normalizeWidgetSettings()` deep-merges partial with `DEFAULT_WIDGET_SETTINGS`, sanitizes hex colors, caps/filters suggestions (max 6), validates footer links. Added public `GET /api/v1/widget/config?token=<token>` endpoint, guarded by `WidgetTokenGuard`, rate-limited (60 req/min), returns `{ agentId, widget }` with fully normalized widget settings. Added `WidgetDeploymentMode` decorator (`'embed' | 'rest'`), enforced by `WidgetTokenGuard` against agent `deploymentSettings.embedEnabled` / `restEnabled`. Embedded snippet (`widget-template.ts`) fetches config on load, applies CSS variables from theme preset + custom colors, handles focus/mobile/reduced-motion, escapes HTML/script contexts via `escapeHtml()`/`stringifyForScript()`. Frontend `AgentDeploymentSection.tsx` includes collapsible widget settings pane (`WidgetSettingsPane`) with 6 theme presets, custom colors, suggestions, labels, privacy, behavior toggles, and live preview (`WidgetLivePreview`). Widget DTOs accept `clientContext` (`WidgetClientContextDto`). Sessions store `clientContext`, `appSource` (channel, appSourceName, sourceInstanceId), and `geo` (defaults to `{ status: 'unavailable' }`). Migration `2026-07-09-backfill-widget-deployment-modes.ts` backfills both `embedEnabled` and `restEnabled` for agents with active non-expired tokens.
- **Why:** Enable external embeddable webchat widget with full styling/theming, origin-restricted token authentication, and dual deployment mode support (real-time embed + synchronous REST). Public config endpoint lets snippet fetch runtime settings without auth exposure.
- **Impact:** `widget-chat.module.ts`, `widget-chat.controller.ts`, `agent-integration.controller.ts`, `widget-chat.service.ts`, `widget-token.guard.ts`, `widget-token.guard.spec.ts`, `widget-deployment-mode.decorator.ts`, `widget-session.schema.ts`, `widget-chat.dto.ts`, `widget-chat.service.spec.ts`, `widget-component-normalizer.spec.ts`, `agent.schema.ts`, `agent.interface.ts`, `agent.service.ts`, `create-agent.dto.ts`, `widget-default-settings.ts` (backend), `AgentDeploymentSection.tsx`, `AgentDeploymentSection.test.tsx`, `AgentFormSchema.ts`, `WidgetSettingsPane.tsx`, `WidgetLivePreview.tsx`, `WidgetSuggestionEditor.tsx`, `widget-template.ts`, `widget-template.spec.ts`, `widget-default-settings.ts` (frontend), `widget-theme-presets.ts`, `widget-styles.ts`, `types.ts`, `locales/{en,fr}.json`, migration script. Backend build/tests PASS; frontend build/tests PASS; frontend QA PASS; reviewer PASS.

### 2026-07-10 14:00 UTC
- **Changed:** `AgentDeploymentSection.tsx` layout restructured from 2-column grid with toggle switches to full-width vertical panes collapsed by default. Embed and REST panes expand independently through header buttons; enable/disable switches remain separate controls. Generated embed snippet output and REST API spec now render inside the corresponding expanded pane.
- **Why:** Improve UX for deployment UI — collapsible panes reduce visual noise, inline output display avoids context switching, and independent expansion lets admins work with both channels simultaneously.
- **Impact:** `AgentDeploymentSection.tsx`, `AgentDeploymentSection.test.tsx` (frontend). Frontend build/tests PASS; frontend QA PASS; reviewer PASS.

### 2026-07-10 14:30 UTC
- **Changed:** `IntegrationSnippetPanel.tsx` now constrains the snippet viewport/pre block with `whitespace-pre-wrap break-all` so generated single-line JavaScript wraps inside the modal/panel. Copy functionality retains the original (unwrapped) source.
- **Why:** Single-line generated snippet overflowed the panel horizontally on narrow modals; wrapping only affects display, not clipboard copy, preserving original source for paste.
- **Impact:** `IntegrationSnippetPanel.tsx` (frontend agent module). Frontend build PASS; frontend QA PASS desktop/mobile.

## Related Notes
- [[widget-deployment-mode-enforcement]] — Architecture: `WidgetTokenGuard` deployment mode enforcement and token validation
- [[agent-guardrails]] — Peer feature (agent deployment has guardrails tab alongside widget)
- [[widget-chat-module-README]] — 345-line internal module README with architecture diagram, error codes, full data flow