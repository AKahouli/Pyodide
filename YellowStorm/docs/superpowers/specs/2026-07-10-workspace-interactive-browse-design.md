# Workspace Interactive Browse-and-Pick Link Indexing — Design

**Date:** 2026-07-10
**Branch:** feature/index_web_sources (continues)
**Status:** Approved, pending implementation plan
**Supersedes:** `2026-07-08-workspace-link-crawl-design.md` (the crawler + tree
approach — removed by this design)
**Builds on:** `2026-07-08-workspace-links-design.md` (the single-link
convert → PDF → index pipeline, which is retained)

## Goal

Replace the automatic crawler with **interactive browsing**. The user submits a
starting URL; we open a **real, live browser** (server-side Chromium, streamed to
the frontend) that the user drives with mouse and keyboard. **Every page the user
navigates to is recorded into a collection sidebar.** When finished, the user
reviews the sidebar — select / deselect / delete — and sends the chosen pages to
be converted and indexed. Conversions are sent **one at a time** (with a small
delay) so target sites do not rate-limit (429) the conversion service.

## Why the crawler is being removed

The crawler auto-discovers sub-pages, which (a) surfaces noise the user did not
want, (b) makes it hard for the user to express what they actually want, and
(c) fired many conversions that hit 429s. The user judged it "useless." Letting
the user browse and pick exactly what they want is the replacement.

## Non-Goals

- No new indexing pipeline. Each selected page reuses the existing
  `convertAndStore` → `queueDocument` flow unchanged.
- No crawler, no sitemap discovery, no page tree (all removed).
- No headless-browser reuse of the worky/manager VNC stack (see Decision 1).
- Not a general-purpose remote-desktop product; the browser session is a
  short-lived, single-tab, single-user picking tool.

## Decisions (resolved during brainstorming)

1. **Self-contained Playwright browser-session service in the Nest backend.**
   The worky/manager VNC browser was considered but rejected: it is owned by the
   external conversation-v2 manager and, crucially, emits page URLs only when the
   *agent* drives the browser — a *human* taking over produces no navigation
   events. Owning our own Playwright/CDP session makes navigation capture trivial
   and keeps the feature in this repo.
2. **Transport = CDP screencast over WebSocket** (not Xvfb+VNC). Headless
   Chromium; `Page.startScreencast` → JPEG frames relayed over a WS → painted to a
   `<canvas>`. User mouse/scroll/keyboard → WS → CDP `Input.*`. No X server / no
   VNC daemon — pure Node + Playwright.
3. **Navigation capture** = `page.on('framenavigated')` on the **main frame**
   only → push `{url, title}` to the client → sidebar entry (deduped by
   normalized URL).
4. **Security: guard every navigation, not just the first.** A user-steered
   server-side browser is an SSRF engine. Reuse `url-safety.ts`
   (`assertUrlIsSafe`) to abort navigations to private / loopback / link-local /
   CGNAT / cloud-metadata ranges, surfacing a "blocked for security" notice.
5. **Sequential conversion with a fixed ~2s delay.** `addLinks` changes from
   concurrency-capped fan-out to strictly one-at-a-time with a configurable
   inter-item delay (default 2000ms) so the target's rate-limit window resets
   between pages.
6. **Session lifecycle:** one shared Playwright Chromium; one `BrowserContext`
   + `page` per session. Idle timeout (~5 min), hard max lifetime (~20 min),
   teardown on dialog close / WS drop. Concurrency cap on simultaneous sessions
   (POC: ~3–5); over the cap returns "busy, try again."
7. **Playwright ships in the backend image** (`npx playwright install chromium`
   at build + system libs). Approved by the user.

## Background (existing pieces this reuses)

- `convertAndStore(documentId, workspaceId, url, filename)`
  (`back/src/modules/workspace/workspace-document.service.ts`) — per-URL
  convert → PDF (Gotenberg wrapper) → upload → `queueDocument`. **Unchanged.**
- `WorkspaceDoc` schema `type: 'url'`, placeholder-doc creation, web-icon UI,
  live indexing-status polling. **Unchanged.**
- `url-safety.ts` (`assertUrlIsSafe`) — SSRF guard, reused for per-navigation
  checks.
- WS gateway pattern from `whatsapp.gateway.ts`.
- Frontend `AddLinkDialog.tsx` — its body is replaced; the entry point (Add
  link) is kept.

## Removed

- Backend: `POST workspace-documents/crawl`, `crawlSite`,
  `website-crawler.service.ts`, `services/page-tree.ts` (`PageNode` trie),
  `dto/crawl-url.dto.ts`, related config (`crawl*` limits, `crawlUserAgent`)
  and tests.
- Frontend: the crawl + tree phase of `AddLinkDialog`, `PageTree.tsx` and its
  tests.

## Architecture

### Backend — new `browser-session` module

- **`BrowserSessionService`**
  - `create(userId, startUrl)` → checks concurrency cap; launches a
    `BrowserContext` + `page`; `assertUrlIsSafe(startUrl)`; `page.goto`;
    `Page.startScreencast`; registers `framenavigated` and screencast-frame
    listeners; starts idle + max-lifetime timers. Returns a `sessionId`.
  - `input(sessionId, event)` → maps client mouse/scroll/keyboard to CDP
    `Input.dispatchMouseEvent` / `dispatchKeyEvent`.
  - `navigate(sessionId, action)` → `goto` / `back` / `forward` / `reload`,
    each `assertUrlIsSafe`-guarded.
  - `destroy(sessionId)` → stop screencast, close context, clear timers.
  - Emits to the gateway: `frame` (JPEG b64), `navigated` `{url, title}`,
    `blocked` `{url, reason}`, `closed`.
- **`BrowserSessionGateway`** (WS) — one room per `sessionId`; relays frames
  and events out, input/navigate in; `destroy` on disconnect.
- **Guards:** every navigation (initial, link-follow, address-bar, back/forward)
  runs `assertUrlIsSafe`; disallowed → abort + `blocked` event.

### Backend — changed conversion

- `addLinks` (endpoint `POST workspace-documents/links` unchanged): create the
  placeholder docs as today, then convert **sequentially** — `for` loop
  awaiting each `convertAndStore`, `await delay(SEQUENTIAL_DELAY_MS)` between
  items (default 2000ms, config `INDEXING_SEQUENTIAL_DELAY_MS`). No behavioural
  change to `convertAndStore` itself.

### Frontend — new interactive dialog (replaces `AddLinkDialog` body)

- **`BrowserSessionViewer`** — a `<canvas>` painting screencast frames; captures
  mouse (coords scaled canvas→viewport), scroll, keyboard → WS; connection state
  (connecting / live / busy / error).
- **Chrome bar** — back / forward / reload / editable address bar (the escape
  hatch for JS-only dead ends).
- **Collection sidebar** — auto-adds each visited page `{title, url, favicon}`,
  deduped by normalized URL; per-row select / deselect / delete; rows already
  indexed in this workspace shown disabled with a badge. Footer **"Index
  selected (N)"** → `POST …/links` with the selected URLs → dialog closes → docs
  appear with the usual live indexing status.
- **`useBrowserSession`** hook — owns the WS, exposes frames, nav events,
  send-input / navigate, and the collected list.

## Data flow

```
user submits URL
  → POST create session (SSRF-checked) → sessionId + WS url
  → WS connect → screencast frames → <canvas>
  → user clicks/types → WS input → CDP Input.* → page navigates
  → framenavigated → { url, title } → sidebar (deduped)
  → user curates sidebar (select/deselect/delete)
  → "Index selected (N)" → POST /links [urls]
  → placeholder docs created → sequential convertAndStore (2s apart)
  → each: convert→PDF→upload→queueDocument → live status in doc list
  → dialog closes; browser session destroyed
```

## Error handling

- **Session over cap** → 4xx "busy"; dialog shows retry.
- **Blocked navigation (SSRF)** → `blocked` event; inline "blocked for security"
  banner; browser stays on the previous page.
- **Screencast/WS drop** → viewer shows disconnected + reconnect; session
  auto-destroyed after idle/max-lifetime.
- **Conversion failure** (per URL) → unchanged: that doc goes `failed` with the
  existing error surface; sequential loop continues to the next URL.
- **Target 429 during conversion** → mitigated by strict sequential + 2s delay;
  a still-failing page is marked `failed` like any other.

## Testing

- **Backend**
  - Session lifecycle: create / idle-timeout / max-lifetime / explicit destroy
    close the context and clear timers.
  - Navigation capture: `framenavigated` emits `{url, title}`; sub-frame
    navigations are ignored.
  - SSRF: navigations to private/loopback/link-local/CGNAT/metadata ranges are
    aborted and emit `blocked` (initial, link, address-bar, back/forward).
  - Concurrency cap: N+1th session is rejected.
  - `addLinks` runs strictly sequential with the configured delay (fake timers;
    assert ordering + spacing; a failed item does not stop the rest).
- **Frontend**
  - Sidebar: dedup by normalized URL, select/deselect/delete, already-indexed
    rows disabled.
  - Canvas input mapping: canvas coords → viewport coords sent over WS.
  - "Index selected" posts exactly the selected URL set.
  - (WS/screencast mocked.)

## Ops

- Backend image: install Chromium + system libs
  (`npx playwright install --with-deps chromium`) at build.
- Config: `INDEXING_SEQUENTIAL_DELAY_MS` (2000), browser session
  concurrency cap, idle/max-lifetime timeouts.

## Open follow-ups (not in scope)

- Multi-tab browsing within a session.
- Persisting a session across dialog reopen.
- Reusing collected sidebars between visits.
