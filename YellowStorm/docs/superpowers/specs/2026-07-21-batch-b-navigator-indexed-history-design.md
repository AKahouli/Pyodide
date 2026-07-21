# Batch B — pre-load a site's indexed history (with status) on double-click — Design

**Status:** Approved (brainstorming complete) — ready for implementation planning.

This is the second batch of the navigator work. It realizes the "continue mode" that Batch A scoped out. The Explore/web-crawler capability is a **separate** later cycle (a crawler existed and was deleted 2026-07-10; it will be rebuilt fresh, likely as in-page link extraction).

## Problem

Double-clicking a start-URL group opens the navigator and auto-starts browsing the root, but the collection sidebar **starts empty** — `session.start` resets `pages`, and `AddLinkDialog` passes a hardcoded `indexedUrls={new Set()}`. The user can't see which pages of that site are already indexed or their status; they'd have to re-browse everything to know what's covered.

## Goal

On double-click ("continue mode"), pre-load the group's **already-indexed pages** into the sidebar with their **indexing status**, as read-only context. Newly-browsed pages remain selectable and are the only ones indexed.

## Locked Decisions (from brainstorming)

1. **Frontend-only.** All needed fields (`sourceUrl`, `indexingStatus`) already reach the frontend via the classifier `toResponse`, and `WorkspacePage` already holds `group.files` at the double-click call site. No backend query/endpoint is added.
2. **Seed the sidebar from `group.files`.** The double-click threads a `seed` (the group's docs, mapped to collected pages carrying their `indexingStatus`) through `openAddLink`.
3. **Seeded pages are context, not re-indexed.** They show with a status dot, stay disabled ("already indexed"), and are excluded from selection/`chosen`. This re-introduces the exclude-already-indexed filter Batch A removed — but **conditioned on the seed**, so clean-slate mode (no seed → empty `indexedUrls`) still allows duplicates exactly as Batch A made it.
4. **Per-page status dot** in the sidebar via the existing `IndexingStatusDot`.

## Architecture & Data Flow

### Types
- `useBrowserSession.CollectedPage` gains `indexingStatus?: IndexingStatus` (imported from `../types`). Seeded pages carry it; browsed/manual pages leave it unset.
- A `SeedPage` shape `{ url: string; name?: string; indexingStatus?: IndexingStatus }` is what the store carries; `AddLinkDialog` maps it to `CollectedPage`.

### Store (`store.ts`)
- `addLinkDialog` state gains `seed: SeedPage[]` (default `[]`).
- `openAddLink(options?: { url?; autoStart?; seed?: SeedPage[] })` sets `seed: options?.seed ?? []`; `closeAddLink` resets it to `[]`. Existing callers ("Ajouter un lien", drag-drop) pass no seed → clean slate.

### Double-click (`WorkspacePage.tsx`)
The group's `onOpenInNavigator` already closes over `group`, so it passes the seed:

```tsx
onOpenInNavigator={(url) => openAddLink({
  url,
  autoStart: true,
  seed: group.files
    .filter((f) => f.sourceUrl)
    .map((f) => ({ url: f.sourceUrl as string, name: f.name, indexingStatus: f.indexingStatus })),
})}
```

### Browser session (`useBrowserSession.ts`)
`start` accepts an optional seed and pre-populates `pages`/`seenRef` instead of emptying them:

```ts
const start = useCallback((url: string, seed: CollectedPage[] = []) => {
  ...
  seenRef.current = new Set(seed.map((p) => normalizeUrl(p.url)));
  setPages(seed); setFrame(null); setBlockedNotice(null); setCurrentUrl(url); setRootUrl(url);
  ...
}, []);
```

Subsequent `navigated` events append new pages (deduped by `seenRef`), so browsing to a page already in the seed is ignored (it's already shown with its status).

### Dialog (`AddLinkDialog.tsx`)
- The autoStart open-effect (continue mode) maps `addLinkDialog.seed` to `CollectedPage[]` (`{ url, linkText: name, indexingStatus }`) and calls `session.start(initialUrl, seedPages)`.
- `indexedUrls` becomes a memo over the seed: `new Set(seed.map((s) => normalizeUrl(s.url)))` (empty when no seed).
- Re-introduce the exclude filter (conditioned on `indexedUrls`, which is empty in clean-slate mode): the auto-select effect only selects pages **not** in `indexedUrls`; `chosen = session.pages.map((p) => p.url).filter((u) => selected.has(u) && !indexedUrls.has(normalizeUrl(u)))`.
- Pass the real `indexedUrls` to `CollectionSidebar` (replaces the hardcoded `new Set()`).

### Sidebar (`CollectionSidebar.tsx`)
- `TrieNode` gains `indexingStatus?: IndexingStatus`; `buildTrie` copies it from the collected page onto the leaf node (only when the page carries one).
- Each leaf that has an `indexingStatus` renders an `IndexingStatusDot` (imported from `./IndexingStatusDot`) beside its name. Seeded pages remain disabled via the existing `indexedUrls`/`already` logic (now fed real data). New pages render without a dot and remain selectable.

## Edge Cases

- **Clean slate (manual / drag-drop)**: no seed → `session.start(url)` (empty seed) → `indexedUrls` empty → filter no-ops → duplicates allowed (Batch A unchanged).
- **Browsing to a seeded URL**: `seenRef` (pre-seeded) dedups it — no duplicate row, keeps its status.
- **A seeded doc with no `sourceUrl`**: filtered out of the seed (defensive `.filter(f => f.sourceUrl)`).
- **Status freshness**: the dot reflects the workspace's last fetch at open time; re-opening re-seeds fresh. Live per-page status streaming inside the navigator is out of scope.
- **Re-indexing a seeded page**: intentionally not offered (context-only, per the continue-mode decision).
- **`closeAddLink`**: resets `seed` so the next open starts clean.

## Testing

**Store:** `openAddLink({ seed })` sets `addLinkDialog.seed`; `openAddLink()` and `closeAddLink()` leave/reset it `[]`.

**useBrowserSession:** `start(url, seed)` sets `pages` to the seed and `seenRef` to their normalized URLs (a later `navigated` to a seeded URL does not duplicate it); `start(url)` with no seed still resets to empty.

**AddLinkDialog:** with a seed, `chosen`/indexing excludes the seeded (already-indexed) URLs and includes a newly-browsed page; with no seed, indexing includes an already-cached URL (Batch A clean-slate still holds — existing test).

**CollectionSidebar:** a page with `indexingStatus: 'ready'` renders an `IndexingStatusDot`; a page without renders none; `buildTrie` carries `indexingStatus` onto the leaf.

## Out of Scope (later cycles)

- The Explore/web-crawler button (rebuild the deleted crawler as in-page `<a href>` extraction) — its own brainstorm → spec → plan cycle.
- Any backend endpoint to list documents by root URL (not needed — the frontend already has the data).
- Live indexing-status streaming into the open navigator.
- Re-indexing seeded pages from continue mode.

## Global Constraints

- TDD: failing test first, minimal implementation, then commit.
- Conventional commits: `<type>(<scope>): <subject>`. **No `Co-Authored-By` trailer.**
- Colocated tests (`X.test.ts(x)` frontend).
- Clean-slate mode (Batch A) must remain unchanged — the exclude filter is conditioned on a non-empty seeded `indexedUrls`.
- Reuse the existing `IndexingStatusDot`; no backend changes.
