# Browser session: page names from clicked link/button text

**Date:** 2026-07-20
**Status:** Approved
**Supersedes:** the URL-last-segment naming introduced in `2026-07-10-workspace-interactive-browse-design.md` (leaf label only; hierarchy unchanged)

## Problem

In the interactive browser-session sidebar, each collected page is named after the
last path segment of its URL (`CollectionSidebar.buildTrie` → `node.segment`). That
name is often opaque (`p?id=42`, `index.html`, a slug). The human-meaningful name of
a page is almost always the text of the link or button the user clicked to reach it.

We want the visited-page name in the sidebar to be **the text of the clicked
link/button**, falling back sensibly when a navigation was not click-driven.

## Goals

- The sidebar leaf name for a visited page = the text of the link/button clicked to
  navigate there.
- Fallback chain when there is no usable clicked-element text: page `<title>` → last
  URL path segment (today's behavior).
- Keep the existing URL-path tree grouping exactly as-is. Only the visited-page
  **leaf label** changes. Category rows remain URL segments; the full URL remains the
  leaf subtitle.

## Non-goals

- No change to the tree grouping, selection, deletion, indexing, or SSRF logic.
- No change to how frames are streamed or how input is forwarded.
- No name "upgrade" when a URL already collected (without a label) is later reached by
  clicking a button — dedup stays **first-wins** (see Trade-offs).

## Approach (chosen: A — injected click listener + Node binding)

We forward only raw mouse coordinates to Playwright, so the backend does not know
*what* was clicked. We capture it in the page and pair it with the resulting
navigation on the backend.

Rejected alternatives:

- **B — hit-test coordinates on mouse-down** (`elementFromPoint`): fragile (returns
  overlays / wrong child), adds an `evaluate` per mouse-down, misses the true event
  target.
- **C — network-layer inference**: the HTTP request carries no link text. Not viable.

## Design

### 1. Capture (remote browser — `playwright-browser-engine.ts`)

In `launchSession`, per session/context:

- **`context.addInitScript(...)`** injects a **capture-phase** `click` listener on
  `document` into every page/frame, before page scripts run. On click it:
  1. Walks up from `event.target` to the nearest navigational element:
     `a`, `button`, `[role=link]`, `[role=button]`, `[onclick]`.
  2. Extracts a label in priority order: visible `innerText` → `aria-label` →
     `title` → descendant `<img>` `alt`.
  3. Trims, collapses internal whitespace, caps at ~120 chars.
  4. Calls the exposed backend binding with the label.
  It **never** calls `preventDefault` / `stopPropagation`; it is read-only and must
  not alter page behavior. If no navigational ancestor or no label is found, it does
  nothing.
- **`context.exposeBinding('__ysRecordClick', handler)`** — the injected script calls
  `window.__ysRecordClick(label)`. The handler records `{ label, at }` on the session,
  where `at` comes from an injected monotonic clock (see §2).

### 2. Pairing (`PlaywrightSession`)

- The session holds `lastClick: { label: string; at: number } | undefined`.
- On `framenavigated` (main frame only, as today) the session builds the nav event and
  resolves the label via a **pure helper**:

  ```ts
  export function resolveClickLabel(
    lastClick: { label: string; at: number } | undefined,
    now: number,
    ttlMs: number,
  ): string | undefined
  ```

  Returns `lastClick.label` iff `lastClick` exists and `now - lastClick.at <= ttlMs`;
  otherwise `undefined`. The label is **single-use**: `lastClick` is cleared after a
  navigation consumes (or discards) it.
- `navigate()` (goto / back / forward / reload) **clears `lastClick` first**, so
  explicit navigations never inherit a stale click label.
- Time is provided by an injected `now: () => number` (monotonic) so `resolveClickLabel`
  and the session remain unit-testable and free of ambient `Date.now()`. Default source
  is `performance.now()`-style monotonic time on the Node side.

`NavigatedEvent` gains `linkText?: string`. The engine emits `{ url, title, linkText }`.

### 3. Plumbing (types → service → gateway → socket)

- `browser-session.types.ts`: `NavigatedEvent { url: string; title: string; linkText?: string }`.
- `browser-session.service.ts`: the existing `onNavigated` → SSRF re-check →
  `emit('navigated', payload)` path forwards `linkText` unchanged. SSRF logic untouched.
- Gateway: the `navigated` socket payload becomes `{ url, title, linkText? }`.

### 4. Frontend consume (`useBrowserSession.ts`)

- `CollectedPage` gains `linkText?: string`.
- The `navigated` handler stores `linkText` alongside `url` / `title`. Dedup by
  `normalizeUrl` stays **first-wins**.
- No name resolution in the hook — resolution lives in `buildTrie` so the URL-segment
  fallback is free (see §5).

### 5. Display (`CollectionSidebar.tsx`)

- `TrieNode` gains `label?: string`.
- In `buildTrie`, when a node becomes a visited page (`node.url = p.url`), also set:

  ```ts
  node.label = (p.linkText || p.title || '').trim() || undefined;
  ```

- `TrieRows` renders **`node.label ?? node.segment`** as the leaf title and as the
  checkbox / delete `aria-label`. When `linkText` and `title` are both empty, `label`
  is `undefined` and the render falls back to `node.segment` — the last URL segment
  (today's behavior). Category rows and the full-URL subtitle are unchanged.

### 6. Config

Add `clickLabelTtlMs` (default `5000`) to `browser-session.config.ts` via the existing
`registerAs` pattern, env key `BROWSER_SESSION_CLICK_LABEL_TTL_MS`. The session uses it
as the `ttlMs` for `resolveClickLabel`.

## Testing (TDD)

**Backend (unit):**
- `resolveClickLabel`: in-window → returns label; expired (`now - at > ttlMs`) →
  `undefined`; `undefined` input → `undefined`; single-use semantics (session clears
  after consume).
- `NavigatedEvent.linkText` plumbing through service + gateway (extend existing specs):
  a nav event carrying `linkText` reaches the `navigated` emit payload.
- `browser-session.config.spec.ts`: `clickLabelTtlMs` default + env override.

**Backend (boundary — not unit-tested):** the in-page DOM walk + label extraction runs
in a real browser context and is validated by the live smoke check, not a unit test.

**Frontend (unit):**
- `buildTrie`: leaf label uses `linkText` when present; falls back to `title`; falls
  back to URL segment when both empty; grouping unchanged.
- `CollectionSidebar` render: leaf shows clicked text; category shows URL segment;
  subtitle shows full URL.
- `useBrowserSession`: `navigated` with `linkText` yields a `CollectedPage` with
  `linkText`; dedup still first-wins.

## Trade-offs (POC-acceptable)

- **False pairing window:** a click that does not navigate (e.g. opens a menu) followed
  by a JS-driven navigation within `ttlMs` could mislabel that navigation. Mitigated by
  the short, single-use window and clearing `lastClick` on explicit navigation. Not
  worth tightening for a POC.
- **First-wins dedup:** if a URL is first reached by typing / redirect (no label) and
  later via a button, the first (label-less) name sticks. A name-upgrade-on-revisit was
  considered and deliberately deferred to keep dedup simple.

## Files touched

- `back/src/modules/browser-session/browser-session.types.ts` — `NavigatedEvent.linkText`.
- `back/src/modules/browser-session/playwright-browser-engine.ts` — init script,
  `exposeBinding`, `resolveClickLabel`, pairing, `navigate()` clears `lastClick`.
- `back/src/modules/browser-session/browser-session.service.ts` — forward `linkText`.
- `back/src/modules/browser-session/browser-session.gateway.ts` — `navigated` payload.
- `back/src/config/browser-session.config.ts` (+ `.spec.ts`) — `clickLabelTtlMs`.
- `front/src/modules/workspace/hooks/useBrowserSession.ts` — `CollectedPage.linkText`.
- `front/src/modules/workspace/components/CollectionSidebar.tsx` (+ test) —
  `TrieNode.label`, resolution, render.
