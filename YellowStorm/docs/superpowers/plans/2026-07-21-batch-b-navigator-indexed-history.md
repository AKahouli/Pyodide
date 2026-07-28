# Batch B — pre-load indexed history + status on double-click — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-clicking a start-URL group pre-loads that site's already-indexed pages (with their indexing-status dots) into the navigator sidebar as read-only context; only newly-browsed pages get indexed.

**Architecture:** Frontend-only. The double-click threads the group's already-loaded docs (`group.files`) as a `seed` through `openAddLink`; `useBrowserSession.start(url, seed)` pre-populates `pages`/`seenRef`; `AddLinkDialog` marks the seed as already-indexed (`indexedUrls`) and excludes it from indexing; `CollectionSidebar` renders a per-leaf `IndexingStatusDot`.

**Tech Stack:** React + Zustand + Vitest + Testing Library (frontend only).

## Global Constraints

- TDD: failing test first, watch it fail, implement minimally, watch it pass, commit.
- Conventional commits: `<type>(<scope>): <subject>`. **No `Co-Authored-By` trailer.**
- Colocated tests (`X.test.ts(x)`).
- Clean-slate mode (Batch A) must stay unchanged: the exclude-already-indexed filter is conditioned on a non-empty seeded `indexedUrls` (empty in clean-slate).
- Reuse `IndexingStatusDot`; no backend changes.
- Frontend commands run from `YellowStorm/front`. Git repo root is the parent `YellowStorm-poc` — stage repo-root-relative paths, verify with `git status`, don't stage unrelated changes.

---

### Task 1: Store — `addLinkDialog.seed`

**Files:** Modify `front/src/modules/workspace/store.ts`; Test `front/src/modules/workspace/store.test.ts`

**Interfaces:** Produces `addLinkDialog.seed: SeedPage[]` and `openAddLink({..., seed?})` where `SeedPage = { url: string; name?: string; indexingStatus?: string }`.

- [ ] **Step 1: Failing test** — in `store.test.ts` inside `describe('workspace store', ...)`:

```ts
  it('openAddLink carries a seed and closeAddLink clears it', () => {
    const seed = [{ url: 'https://a.com/x', name: 'X', indexingStatus: 'ready' }];
    act(() => { useWorkspaceStore.getState().openAddLink({ url: 'https://a.com', autoStart: true, seed }); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: true, initialUrl: 'https://a.com', autoStart: true, seed });
    act(() => { useWorkspaceStore.getState().closeAddLink(); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: false, initialUrl: '', autoStart: false, seed: [] });
  });

  it('openAddLink defaults seed to empty', () => {
    act(() => { useWorkspaceStore.getState().openAddLink(); });
    expect(useWorkspaceStore.getState().addLinkDialog.seed).toEqual([]);
    act(() => { useWorkspaceStore.getState().closeAddLink(); });
  });
```

- [ ] **Step 2: Run — FAIL**

Run: `cd front && npx vitest run src/modules/workspace/store.test.ts -t "seed"`
Expected: FAIL — `addLinkDialog` has no `seed`.

- [ ] **Step 3: Implement** — in `store.ts`:

Add a `SeedPage` type near the top of the file (after the imports):

```ts
export type SeedPage = { url: string; name?: string; indexingStatus?: string };
```

Change the state type (line ~157):

```ts
  addLinkDialog: { open: boolean; initialUrl: string; autoStart: boolean; seed: SeedPage[] };
```

Change the action type (line ~208):

```ts
  openAddLink: (options?: { url?: string; autoStart?: boolean; seed?: SeedPage[] }) => void;
```

Change the initial state (line ~372):

```ts
  addLinkDialog: { open: false, initialUrl: '', autoStart: false, seed: [] },
```

Change the action impls (lines ~485-489):

```ts
      openAddLink: (options) =>
        set({ addLinkDialog: { open: true, initialUrl: options?.url ?? '', autoStart: options?.autoStart ?? false, seed: options?.seed ?? [] } }),

      closeAddLink: () =>
        set({ addLinkDialog: { open: false, initialUrl: '', autoStart: false, seed: [] } }),
```

- [ ] **Step 4: Run — PASS** — `cd front && npx vitest run src/modules/workspace/store.test.ts -t "seed"` then `cd front && npx tsc --noEmit`. (Note: `WorkspaceUploadDropZone` reads `addLinkDialog` but destructures `open`/`initialUrl`/`autoStart` — adding `seed` is additive; if tsc flags an exhaustive object comparison anywhere, it won't — `seed` is a new optional-in-effect field. The dropzone passes no seed via `openAddLink({url})`, which now defaults it to `[]`.)

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/store.ts YellowStorm/front/src/modules/workspace/store.test.ts
git commit -m "feat(workspace): carry a seed through the add-link dialog state"
```

---

### Task 2: `useBrowserSession` — `CollectedPage.indexingStatus` + seeded `start`

**Files:** Modify `front/src/modules/workspace/hooks/useBrowserSession.ts`; Test `front/src/modules/workspace/hooks/useBrowserSession.test.ts`

**Interfaces:** `CollectedPage` gains `indexingStatus?: IndexingStatus`; `start(url: string, seed?: CollectedPage[])` pre-populates `pages`/`seenRef` from the seed.

- [ ] **Step 1: Failing test** — in `useBrowserSession.test.ts` inside `describe('useBrowserSession', ...)`:

```ts
  it('start seeds the collection and dedups a later navigation to a seeded url', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://root.example', [{ url: 'https://root.example/a', title: '', indexingStatus: 'ready' }]); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.pages).toHaveLength(1);
    expect(result.current.pages[0]).toMatchObject({ url: 'https://root.example/a', indexingStatus: 'ready' });
    act(() => { handlers['navigated']({ url: 'https://root.example/a', title: 'A' }); }); // same as seeded → deduped
    expect(result.current.pages).toHaveLength(1);
    act(() => { handlers['navigated']({ url: 'https://root.example/b', title: 'B' }); }); // new → added
    expect(result.current.pages).toHaveLength(2);
  });
```

- [ ] **Step 2: Run — FAIL** — `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts -t "seeds the collection"`. Expected: FAIL — `start` ignores the seed (pages length 0).

- [ ] **Step 3: Implement** — in `useBrowserSession.ts`:

Import the status type and add the field:

```ts
import type { IndexingStatus } from '../types';
```

```ts
export interface CollectedPage { url: string; title: string; linkText?: string; manual?: boolean; indexingStatus?: IndexingStatus; }
```

Change `start` to accept a seed (the current body sets `seenRef.current = new Set(); setPages([]); ...`):

```ts
  const start = useCallback((url: string, seed: CollectedPage[] = []) => {
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    if (!token) { setStatus('error'); return; }
    setStatus('connecting');
    seenRef.current = new Set(seed.map((p) => normalizeUrl(p.url)));
    setPages(seed); setFrame(null); setBlockedNotice(null); setCurrentUrl(url); setRootUrl(url);
    // ...rest of start (socket setup) unchanged...
```

(Leave the socket setup, `navigated` handler, and everything else unchanged.)

- [ ] **Step 4: Run — PASS** — `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts` then `cd front && npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/hooks/useBrowserSession.ts YellowStorm/front/src/modules/workspace/hooks/useBrowserSession.test.ts
git commit -m "feat(workspace): seed the browse collection with indexed pages"
```

---

### Task 3: `CollectionSidebar` — per-leaf `IndexingStatusDot`

**Files:** Modify `front/src/modules/workspace/components/CollectionSidebar.tsx`; Test `front/src/modules/workspace/components/CollectionSidebar.test.tsx`

**Interfaces:** `TrieNode` gains `indexingStatus?: IndexingStatus`; `buildTrie` copies it onto the leaf; each leaf with a status renders an `IndexingStatusDot`.

- [ ] **Step 1: Failing tests** — in `CollectionSidebar.test.tsx`:

In the `describe('buildTrie', ...)` block:

```ts
  it('carries indexingStatus onto the leaf node', () => {
    const roots = buildTrie([{ url: 'https://ex.com/a', title: '', indexingStatus: 'ready' }]);
    expect(roots[0].children[0].indexingStatus).toBe('ready');
  });
```

In the render-tests area (uses `baseProps`):

```ts
  it('renders a status dot for a page with an indexing status and none without', () => {
    const { rerender } = render(<CollectionSidebar pages={[{ url: 'https://ex.com/a', title: '', linkText: 'A', indexingStatus: 'ready' }]} {...baseProps} onAdd={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Indexé' })).toBeInTheDocument();
    rerender(<CollectionSidebar pages={[{ url: 'https://ex.com/a', title: '', linkText: 'A' }]} {...baseProps} onAdd={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.queryByRole('img', { name: 'Indexé' })).not.toBeInTheDocument();
  });
```

(`IndexingStatusDot` for `ready` renders `role='img'` with `aria-label='Indexé'`.)

- [ ] **Step 2: Run — FAIL** — `cd front && npx vitest run src/modules/workspace/components/CollectionSidebar.test.tsx -t "indexingStatus|status dot"`. Expected: FAIL.

- [ ] **Step 3: Implement** — in `CollectionSidebar.tsx`:

Add imports:

```ts
import type { IndexingStatus } from '../types';
import { IndexingStatusDot } from './IndexingStatusDot';
```

Add the field to `TrieNode`:

```ts
  /** Vectorstore indexing status for a seeded (already-indexed) page; drives a status dot. */
  indexingStatus?: IndexingStatus;
```

In `buildTrie`, in the leaf-marking block (currently `if (!node.url) { node.url = p.url; const label = ...; if (label) node.label = label; }`), also copy the status:

```ts
    if (!node.url) {
      node.url = p.url;
      const label = (p.linkText || p.title || '').replace(/\s+/g, ' ').trim();
      if (label) node.label = label;
      if (p.indexingStatus) node.indexingStatus = p.indexingStatus;
    }
```

In `TrieRows`, inside the `node.url ?` leaf branch, render the dot just after the collapse chevron/spacer and before the `Checkbox` (add it as the first child of the `<>` fragment):

```tsx
              {node.url ? (
                <>
                  {node.indexingStatus && <IndexingStatusDot status={node.indexingStatus} />}
                  <Checkbox
```

- [ ] **Step 4: Run — PASS** — `cd front && npx vitest run src/modules/workspace/components/CollectionSidebar.test.tsx` then `cd front && npx tsc --noEmit`. (All existing sidebar tests still pass — pages without `indexingStatus` render no dot.)

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/CollectionSidebar.tsx YellowStorm/front/src/modules/workspace/components/CollectionSidebar.test.tsx
git commit -m "feat(workspace): show a per-page indexing-status dot in the collection sidebar"
```

---

### Task 4: `AddLinkDialog` — seed continue mode + exclude already-indexed

**Files:** Modify `front/src/modules/workspace/components/AddLinkDialog.tsx`; Test `front/src/modules/workspace/components/AddLinkDialog.test.tsx`

**Interfaces:** Consumes `addLinkDialog.seed` (Task 1), `session.start(url, seed)` (Task 2). In continue mode (seed present), seeds the session, marks the seed as `indexedUrls`, and excludes it from `chosen`/auto-select.

- [ ] **Step 1: Failing test** — in `AddLinkDialog.test.tsx`. The implementation reads the seed via `useWorkspaceStore((s) => s.addLinkDialog.seed)`, so make the store mock carry a settable `seed`. Add near the other mock vars:

```ts
let addLinkSeed: Array<{ url: string; name?: string; indexingStatus?: string }> = [];
```
and change the `vi.mock('../store', ...)` factory's selected object to include `addLinkDialog`:

```ts
vi.mock('../store', () => ({
  useWorkspaceStore: (sel: (s: unknown) => unknown) =>
    sel({ addPageLinks, documents: documentsCache, addLinkDialog: { seed: addLinkSeed } }),
}));
```
In `beforeEach`, add `addLinkSeed = [];`.

Add the test:

```ts
it('seeds already-indexed pages and excludes them from indexing', async () => {
  session.status = 'live';
  session.rootUrl = 'https://ok.example';
  addLinkSeed = [{ url: 'https://ok.example/a', name: 'A', indexingStatus: 'ready' }];
  // the session (seeded via start) reports the seeded page plus a new browsed one
  session.pages = [
    { url: 'https://ok.example/a', title: '', linkText: 'A', indexingStatus: 'ready' },
    { url: 'https://ok.example/b', title: 'B' },
  ];
  render(<AddLinkDialog open autoStart initialUrl='https://ok.example' onOpenChange={vi.fn()} workspaceId='w1' />);
  fireEvent.click(screen.getByRole('button', { name: /Indexer/ }));
  await waitFor(() =>
    expect(addPageLinks).toHaveBeenCalledWith('w1', ['https://ok.example/b'], expect.anything()),
  );
});
```

- [ ] **Step 2: Run — FAIL** — `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx -t "seeds already-indexed"`. Expected: FAIL — with no exclude filter, `chosen` includes `https://ok.example/a` too.

- [ ] **Step 3: Implement** — in `AddLinkDialog.tsx`:

Read the seed and import `useMemo`/`normalizeUrl` back (they were removed in Batch A — re-add):

```ts
import { useEffect, useMemo, useState } from 'react';
import { useBrowserSession, normalizeUrl } from '../hooks/useBrowserSession';
```

```ts
  const seed = useWorkspaceStore((s) => s.addLinkDialog.seed);
```

Compute `indexedUrls` from the seed:

```ts
  const indexedUrls = useMemo(() => new Set(seed.map((s) => normalizeUrl(s.url))), [seed]);
```

In the autoStart branch of the open-effect, pass the seed pages to `start`:

```ts
      if (autoStart && isValidUrl(initialUrl)) {
        setUrl(initialUrl); setError(null); setBusy(false); setSelected(new Set());
        session.start(initialUrl.trim(), seed.map((s) => ({ url: s.url, title: '', linkText: s.name, indexingStatus: s.indexingStatus as CollectedPage['indexingStatus'] })));
        setPhase('browse');
      } else {
```

(Import `type CollectedPage` from `../hooks/useBrowserSession` for the cast, or inline the object without the cast if `indexingStatus` types line up.)

Re-add the exclude filter to auto-select and `chosen`:

```ts
  // Auto-select each newly collected page (never the already-indexed seed).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      session.pages.forEach((p) => { if (!indexedUrls.has(normalizeUrl(p.url))) next.add(p.url); });
      return next;
    });
  }, [session.pages, indexedUrls]);
```

```ts
  const chosen = session.pages
    .map((p) => p.url)
    .filter((u) => selected.has(u) && !indexedUrls.has(normalizeUrl(u)));
```

Change the `CollectionSidebar` render to pass the real `indexedUrls` (was `indexedUrls={new Set()}`):

```tsx
              indexedUrls={indexedUrls}
```

- [ ] **Step 4: Run — PASS** — `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx` then `cd front && npx tsc --noEmit`. Both the new seed test AND the existing Batch A "clean slate allows duplicates" test pass (that test has no seed → `indexedUrls` empty → filter no-ops).

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/AddLinkDialog.tsx YellowStorm/front/src/modules/workspace/components/AddLinkDialog.test.tsx
git commit -m "feat(workspace): continue mode seeds indexed pages and excludes them from indexing"
```

---

### Task 5: `WorkspacePage` — pass the seed on double-click

**Files:** Modify `front/src/modules/workspace/components/WorkspacePage.tsx`

**Interfaces:** Consumes `openAddLink({seed})` (Task 1). No isolated test (wiring) — verified by tsc + smoke.

- [ ] **Step 1: Pass the seed** — change the `SourceGroupRow` `onOpenInNavigator` (currently `onOpenInNavigator={(url) => openAddLink({ url, autoStart: true })}`):

```tsx
                            onOpenInNavigator={(url) => openAddLink({ url, autoStart: true, seed: group.files.filter((f) => f.sourceUrl).map((f) => ({ url: f.sourceUrl as string, name: f.name, indexingStatus: f.indexingStatus })) })}
```

(Keep the `onMove` prop from Batch A on the same element.)

- [ ] **Step 2: Verify** — `cd front && npx tsc --noEmit` (no new errors) and `cd front && npx vitest run src/modules/workspace` (feature tests green; pre-existing unrelated failures may remain).

- [ ] **Step 3: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/WorkspacePage.tsx
git commit -m "feat(workspace): pre-load a group's indexed pages into the navigator on double-click"
```

---

## Final verification

- [ ] `cd front && npx vitest run src/modules/workspace/store.test.ts src/modules/workspace/hooks/useBrowserSession.test.ts src/modules/workspace/components/CollectionSidebar.test.tsx src/modules/workspace/components/AddLinkDialog.test.tsx` — feature tests green.
- [ ] `cd front && npx tsc --noEmit` — no new errors.
- [ ] `cd front && npx vitest run src/modules/workspace` — feature tests green (pre-existing unrelated failures may remain).
- [ ] Live smoke:
  1. Index 2+ pages of a site → a group appears. **Double-click** it → the navigator opens browsing the root, and the sidebar already lists those pages with their **status dots**, marked "Déjà indexée", not selectable.
  2. Browse to a **new** page of the site → it appears below, selectable, no dot → **Indexer** indexes only the new one.
  3. Re-open via **Ajouter un lien** (type a URL) → clean slate: empty sidebar, no dots, duplicates allowed (Batch A unchanged).

## Self-review notes

- **Spec coverage:** seed state → Task 1. `indexingStatus` + seeded start → Task 2. status dot → Task 3. exclude-indexed + wire seed → Task 4. double-click seed → Task 5. Testing → Tasks 1-4 unit tests + smoke.
- **Clean-slate preserved:** the exclude filter keys off `indexedUrls`, which is empty when no seed — Batch A's clean-slate/duplicates test still passes (asserted in Task 4 Step 4).
- **Type consistency:** `SeedPage {url,name?,indexingStatus?}` (store) maps to `CollectedPage.indexingStatus` (hook) → `TrieNode.indexingStatus` (sidebar); `openAddLink({seed})` used identically in Tasks 1/5.
