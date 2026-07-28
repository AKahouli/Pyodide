# Explore / per-link crawler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each collected link in the navigator sidebar gets an Explore button that crawls that link server-side and adds the sublinks under its path into the collection as selectable pages.

**Architecture:** Resurrect the proven `WebsiteCrawlerService` (sitemap-first + BFS, SSRF-safe) from git history; add a `crawlSite` service method (flat return + path-prefix filter) and a `POST /documents/crawl` endpoint; frontend adds a `crawlUrl` api, a batch `useBrowserSession.addPages`, a per-leaf Explore button in `CollectionSidebar`, and `AddLinkDialog.handleExplore` wiring.

**Tech Stack:** NestJS + axios + Jest (backend); React + Zustand + Vitest (frontend).

## Global Constraints

- TDD; conventional commits, **no `Co-Authored-By` trailer**; colocated tests.
- Restore the crawler service/spec/DTO verbatim from history (its deps `assertUrlIsSafe` in `services/url-safety.ts` and `DEFAULT_CRAWL_USER_AGENT` in `config/indexing.config.ts` still exist; the config reads have inline defaults, so no config change is needed).
- Do NOT restore the old `page-tree.ts` / two-phase crawl-tree dialog — the sidebar trie replaces it. `crawlSite` returns a flat `{ pages, truncated }`.
- Backend from `YellowStorm/back`, frontend from `YellowStorm/front`. Git repo root is the parent `YellowStorm-poc`.
- The pre-deletion source is at commit `734c6cc90^` (backend) and `48189a584^` (frontend api).

---

### Task 1: Restore `WebsiteCrawlerService` (+ spec, DTO) and wire it into the module

**Files:** Restore `back/src/modules/workspace/services/website-crawler.service.ts`, `.../website-crawler.service.spec.ts`, `back/src/modules/workspace/dto/crawl-url.dto.ts`; Modify `back/src/modules/workspace/workspace.module.ts`.

**Interfaces:** Produces the injectable `WebsiteCrawlerService` with `crawl(seedUrl): Promise<{ pages: { url; title? }[]; truncated }>`, and `CrawlUrlDto { url }`.

- [ ] **Step 1: Restore the files from history**

Run (from repo root `YellowStorm-poc`):

```bash
git show 734c6cc90^:YellowStorm/back/src/modules/workspace/services/website-crawler.service.ts > YellowStorm/back/src/modules/workspace/services/website-crawler.service.ts
git show 734c6cc90^:YellowStorm/back/src/modules/workspace/services/website-crawler.service.spec.ts > YellowStorm/back/src/modules/workspace/services/website-crawler.service.spec.ts
git show 734c6cc90^:YellowStorm/back/src/modules/workspace/dto/crawl-url.dto.ts > YellowStorm/back/src/modules/workspace/dto/crawl-url.dto.ts
```

- [ ] **Step 2: Wire the provider**

In `back/src/modules/workspace/workspace.module.ts`, add the import and the provider:

```ts
import { WebsiteCrawlerService } from './services/website-crawler.service';
```

Add `WebsiteCrawlerService,` to the `providers: [ ... ]` array (next to `WorkspaceDocumentService`).

- [ ] **Step 3: Run the restored spec + tsc**

Run: `cd back && npx jest src/modules/workspace/services/website-crawler.service.spec.ts`
Expected: PASS (the restored spec matches the restored service verbatim).

Run: `cd back && npx tsc --noEmit`
Expected: no new errors (deps `assertUrlIsSafe`, `DEFAULT_CRAWL_USER_AGENT` resolve).

If the restored spec references anything no longer present (e.g. a moved import), fix the import path minimally and note it; do not change the crawler's logic.

- [ ] **Step 4: Commit**

```bash
git add YellowStorm/back/src/modules/workspace/services/website-crawler.service.ts YellowStorm/back/src/modules/workspace/services/website-crawler.service.spec.ts YellowStorm/back/src/modules/workspace/dto/crawl-url.dto.ts YellowStorm/back/src/modules/workspace/workspace.module.ts
git commit -m "feat(workspace): restore WebsiteCrawlerService and crawl DTO"
```

---

### Task 2: `crawlSite` (flat + path filter) + crawl endpoint

**Files:** Modify `back/src/modules/workspace/workspace-document.service.ts`; Test `back/src/modules/workspace/workspace-document.service.spec.ts`; Modify `back/src/modules/workspace/workspace-document.controller.ts`.

**Interfaces:** Consumes `WebsiteCrawlerService` (Task 1). Produces `crawlSite(workspaceId, url): Promise<{ pages: { url; title? }[]; truncated }>` returning only pages under the seed's path, and `POST /workspaces/:id/documents/crawl`.

- [ ] **Step 1: Write the failing test**

In `workspace-document.service.spec.ts`, add a focused describe that constructs the service (or reuses the existing `addLink` block's DI setup) with a stubbed `WebsiteCrawlerService`. If reusing an existing block is awkward, create a minimal one that instantiates the service with a crawler stub:

```ts
  it('crawlSite returns only pages under the seed path', async () => {
    (service as any).websiteCrawler = {
      crawl: jest.fn().mockResolvedValue({ pages: [{ url: 'https://a.com/docs/x' }, { url: 'https://a.com/pricing' }], truncated: false }),
    };
    const res = await service.crawlSite(WS_ID, 'https://a.com/docs');
    expect(res.pages.map((p) => p.url)).toEqual(['https://a.com/docs/x']);
    expect(res.truncated).toBe(false);
  });

  it('crawlSite (root seed) keeps all pages', async () => {
    (service as any).websiteCrawler = {
      crawl: jest.fn().mockResolvedValue({ pages: [{ url: 'https://a.com/docs/x' }, { url: 'https://a.com/pricing' }], truncated: true }),
    };
    const res = await service.crawlSite(WS_ID, 'https://a.com');
    expect(res.pages).toHaveLength(2);
    expect(res.truncated).toBe(true);
  });
```

(Assign the stub onto the instance so the DI shape of the existing block doesn't need a new provider; the constructor param for `WebsiteCrawlerService` must exist — see Step 3.)

- [ ] **Step 2: Run — FAIL**

Run: `cd back && npx jest src/modules/workspace/workspace-document.service.spec.ts -t "crawlSite"`
Expected: FAIL — `crawlSite` does not exist.

- [ ] **Step 3: Implement `crawlSite` + inject the crawler**

In `back/src/modules/workspace/workspace-document.service.ts`:

Add the import and constructor param:

```ts
import { WebsiteCrawlerService } from './services/website-crawler.service';
```

Add `private readonly websiteCrawler: WebsiteCrawlerService,` to the constructor parameter list.

Add the method (place near `checkUrls`):

```ts
  /**
   * Crawl a seed URL and return the discovered pages that live UNDER the seed's
   * path (so "Explore" on /docs yields /docs/*; a root seed yields the whole site).
   */
  async crawlSite(_workspaceId: string, url: string): Promise<{ pages: Array<{ url: string; title?: string }>; truncated: boolean }> {
    const { pages, truncated } = await this.websiteCrawler.crawl(url);
    let seedPath = '/';
    try { seedPath = new URL(url).pathname.replace(/\/+$/, '') || '/'; } catch { /* keep '/' */ }
    const underSeed = (candidate: string): boolean => {
      try {
        const p = new URL(candidate).pathname;
        if (seedPath === '/') return true;
        return p === seedPath || p.startsWith(`${seedPath}/`);
      } catch { return false; }
    };
    return { pages: pages.filter((p) => underSeed(p.url)), truncated };
  }
```

- [ ] **Step 4: Add the endpoint**

In `back/src/modules/workspace/workspace-document.controller.ts`, add the import and the handler (next to the `links` handler):

```ts
import { CrawlUrlDto } from './dto/crawl-url.dto';
```

```ts
  @Post('crawl')
  @UseGuards(WritePermissionGuard)
  @ApiOperation({ summary: 'Crawl a link and return sublinks under its path' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  async crawl(
    @Param('workspaceId') workspaceId: string,
    @Body() body: CrawlUrlDto,
  ) {
    return this.workspaceDocumentService.crawlSite(workspaceId, body.url);
  }
```

- [ ] **Step 5: Run — PASS + tsc**

Run: `cd back && npx jest src/modules/workspace/workspace-document.service.spec.ts -t "crawlSite"` then `cd back && npx tsc --noEmit`.
Expected: PASS, no new tsc errors. (The service constructor gained a param; if any OTHER service spec instantiates `WorkspaceDocumentService` via `Test.createTestingModule`, it must provide `WebsiteCrawlerService` — add `{ provide: WebsiteCrawlerService, useValue: {} }` to those modules if tsc/those tests break. Only touch specs that fail.)

- [ ] **Step 6: Commit**

```bash
git add YellowStorm/back/src/modules/workspace/workspace-document.service.ts YellowStorm/back/src/modules/workspace/workspace-document.service.spec.ts YellowStorm/back/src/modules/workspace/workspace-document.controller.ts
git commit -m "feat(workspace): add crawlSite path-scoped crawl endpoint"
```

---

### Task 3: Frontend `crawlUrl` api + endpoint config

**Files:** Modify `front/src/lib/api/config.ts`, `front/src/modules/workspace/api.ts`; Test `front/src/modules/workspace/api.crawl.test.ts` (restore/adapt).

**Interfaces:** Produces `crawlUrl(workspaceId, url): Promise<{ pages: { url: string; title?: string }[]; truncated: boolean }>`.

- [ ] **Step 1: Add the endpoint + api function**

In `front/src/lib/api/config.ts`, in `API_ENDPOINTS.workspaceDocuments`, add:

```ts
    crawl: (workspaceId: string) => `/workspaces/${workspaceId}/documents/crawl`,
```

In `front/src/modules/workspace/api.ts`, add:

```ts
/** Crawl a link and return the sublinks under its path. */
export async function crawlUrl(workspaceId: string, url: string): Promise<{ pages: Array<{ url: string; title?: string }>; truncated: boolean }> {
  const response = await apiClient.post<ApiResponse<{ pages: Array<{ url: string; title?: string }>; truncated: boolean }>>(
    API_ENDPOINTS.workspaceDocuments.crawl(workspaceId),
    { url },
  );
  return response.data.data;
}
```

- [ ] **Step 2: Test** — create `front/src/modules/workspace/api.crawl.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ default: { post }, ApiResponse: undefined }));

import { crawlUrl } from './api';

beforeEach(() => post.mockReset());

describe('crawlUrl', () => {
  it('posts the url and returns the discovered pages', async () => {
    post.mockResolvedValue({ data: { data: { pages: [{ url: 'https://a.com/docs/x' }], truncated: false } } });
    const res = await crawlUrl('w1', 'https://a.com/docs');
    expect(post).toHaveBeenCalledWith('/workspaces/w1/documents/crawl', { url: 'https://a.com/docs' });
    expect(res.pages[0].url).toBe('https://a.com/docs/x');
  });
});
```

- [ ] **Step 3: Run + tsc** — `cd front && npx vitest run src/modules/workspace/api.crawl.test.ts` (PASS) then `cd front && npx tsc --noEmit`. (If the client mock shape differs from how `api.ts` imports `apiClient`/`ApiResponse`, match the existing import in `api.ts` — it is `import apiClient, { ApiResponse } from '@/lib/api/client';`.)

- [ ] **Step 4: Commit**

```bash
git add YellowStorm/front/src/lib/api/config.ts YellowStorm/front/src/modules/workspace/api.ts YellowStorm/front/src/modules/workspace/api.crawl.test.ts
git commit -m "feat(workspace): add crawlUrl api for the Explore button"
```

---

### Task 4: `useBrowserSession.addPages` (batch add)

**Files:** Modify `front/src/modules/workspace/hooks/useBrowserSession.ts`; Test `.../useBrowserSession.test.ts`.

**Interfaces:** Produces `addPages(pages: CollectedPage[]): number` — batch-adds deduped by `seenRef`, returns the count added.

- [ ] **Step 1: Failing test**

```ts
  it('addPages batch-adds new pages and dedups already-seen ones', () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.addManualPage('https://a.com/x'); });
    let added!: number;
    act(() => { added = result.current.addPages([{ url: 'https://a.com/x', title: '' }, { url: 'https://a.com/y', title: 'Y' }]); });
    expect(added).toBe(1); // x already seen, y new
    expect(result.current.pages.map((p) => p.url)).toContain('https://a.com/y');
  });
```

- [ ] **Step 2: Run — FAIL** — `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts -t "addPages"`. Expected: FAIL — not a function.

- [ ] **Step 3: Implement** — in `useBrowserSession.ts`, after `addManualPage`/`updatePage`:

```ts
  const addPages = useCallback((incoming: CollectedPage[]): number => {
    const fresh = incoming.filter((p) => {
      const key = normalizeUrl(p.url);
      if (seenRef.current.has(key)) return false;
      seenRef.current.add(key);
      return true;
    });
    if (fresh.length > 0) setPages((prev) => [...prev, ...fresh]);
    return fresh.length;
  }, []);
```

Add `addPages` to the returned object.

- [ ] **Step 4: Run — PASS + tsc** — full hook test file + `cd front && npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/hooks/useBrowserSession.ts YellowStorm/front/src/modules/workspace/hooks/useBrowserSession.test.ts
git commit -m "feat(workspace): add batch addPages to useBrowserSession"
```

---

### Task 5: `CollectionSidebar` — per-leaf Explore button

**Files:** Modify `front/src/modules/workspace/components/CollectionSidebar.tsx`; Test `.../CollectionSidebar.test.tsx`.

**Interfaces:** Produces optional props `onExplore?: (url: string) => void` and `exploring?: Set<string>`; each leaf renders an Explore button (calls `onExplore(node.url)`) that spins/disables while its URL is in `exploring`.

- [ ] **Step 1: Failing test**

```ts
  it('calls onExplore with the leaf url and shows a spinner while exploring', () => {
    const onExplore = vi.fn();
    const { rerender } = render(<CollectionSidebar pages={[{ url: 'https://ex.com/a', title: '', linkText: 'A' }]} {...baseProps} onAdd={vi.fn()} onEdit={vi.fn()} onExplore={onExplore} exploring={new Set()} />);
    fireEvent.click(screen.getByLabelText('explore https://ex.com/a'));
    expect(onExplore).toHaveBeenCalledWith('https://ex.com/a');
    rerender(<CollectionSidebar pages={[{ url: 'https://ex.com/a', title: '', linkText: 'A' }]} {...baseProps} onAdd={vi.fn()} onEdit={vi.fn()} onExplore={onExplore} exploring={new Set(['https://ex.com/a'])} />);
    expect(screen.getByLabelText('explore https://ex.com/a')).toBeDisabled();
  });
```

- [ ] **Step 2: Run — FAIL** — `-t "onExplore"`.

- [ ] **Step 3: Implement** — in `CollectionSidebar.tsx`:

Add `Compass` and `Loader2` to the lucide import. Add `onExplore`/`exploring` to `CollectionSidebar` props and thread them through `TrieRows` (like `onEdit`). In the leaf branch, before `{onEdit && <EditLeafPopover .../>}`, add:

```tsx
                  {onExplore && (
                    <button
                      type='button'
                      aria-label={`explore ${node.url}`}
                      disabled={exploring?.has(node.url as string)}
                      onClick={() => onExplore(node.url as string)}
                      className='shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50'
                    >
                      {exploring?.has(node.url as string) ? <Loader2 className='h-4 w-4 animate-spin' /> : <Compass className='h-4 w-4' />}
                    </button>
                  )}
```

Thread `onExplore`/`exploring` through the `TrieRows` props type, its recursive call, and the top-level `<TrieRows>` render in `CollectionSidebar`.

- [ ] **Step 4: Run — PASS + tsc** — full sidebar test file + `cd front && npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/CollectionSidebar.tsx YellowStorm/front/src/modules/workspace/components/CollectionSidebar.test.tsx
git commit -m "feat(workspace): add a per-link Explore button to CollectionSidebar"
```

---

### Task 6: `AddLinkDialog` — wire Explore

**Files:** Modify `front/src/modules/workspace/components/AddLinkDialog.tsx`; Test `.../AddLinkDialog.test.tsx`.

**Interfaces:** Consumes `crawlUrl` (Task 3), `session.addPages` (Task 4), `CollectionSidebar.onExplore`/`exploring` (Task 5).

- [ ] **Step 1: Failing test** — the mock `session` gains `addPages: vi.fn().mockReturnValue(2)`; mock `crawlUrl` from `../api`. Add:

```ts
it('explores a link and adds the discovered pages', async () => {
  session.status = 'live';
  session.pages = [{ url: 'https://ok.example/docs', title: 'Docs' }];
  render(<AddLinkDialog open onOpenChange={vi.fn()} workspaceId='w1' />);
  fireEvent.click(screen.getByLabelText('explore https://ok.example/docs'));
  await waitFor(() => expect(crawlUrlMock).toHaveBeenCalledWith('w1', 'https://ok.example/docs'));
  await waitFor(() => expect(session.addPages).toHaveBeenCalled());
});
```

Add the crawl mock near the top: `const crawlUrlMock = vi.fn().mockResolvedValue({ pages: [{ url: 'https://ok.example/docs/a' }], truncated: false });` and `vi.mock('../api', () => ({ crawlUrl: crawlUrlMock }));` (if `../api` is already mocked for `checkUrls`, extend that mock instead — but Batch A removed `checkUrls` from this dialog, so a fresh `vi.mock('../api', ...)` with `crawlUrl` is fine).

- [ ] **Step 2: Run — FAIL** — `-t "explores a link"`.

- [ ] **Step 3: Implement** — in `AddLinkDialog.tsx`:

```ts
import { crawlUrl } from '../api';
```

```ts
  const [exploring, setExploring] = useState<Set<string>>(new Set());
  const handleExplore = async (url: string) => {
    setExploring((p) => new Set(p).add(url));
    try {
      const { pages, truncated } = await crawlUrl(workspaceId, url);
      const added = session.addPages(pages.map((p) => ({ url: p.url, title: p.title ?? '' })));
      toast.success(`${added} page(s) trouvée(s)${truncated ? ' (limite atteinte)' : ''}`);
    } catch {
      toast.error("L'exploration a échoué.");
    } finally {
      setExploring((p) => { const n = new Set(p); n.delete(url); return n; });
    }
  };
```

Pass to the sidebar: `onExplore={handleExplore}` and `exploring={exploring}`.

- [ ] **Step 4: Run — PASS + tsc** — full dialog test file + `cd front && npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/AddLinkDialog.tsx YellowStorm/front/src/modules/workspace/components/AddLinkDialog.test.tsx
git commit -m "feat(workspace): wire the Explore button to the crawler"
```

---

## Final verification

- [ ] Backend: `cd back && npx jest src/modules/workspace/services/website-crawler.service.spec.ts src/modules/workspace/workspace-document.service.spec.ts -t "crawl"` — green; `cd back && npx tsc --noEmit` — clean.
- [ ] Frontend: `cd front && npx vitest run src/modules/workspace/api.crawl.test.ts src/modules/workspace/hooks/useBrowserSession.test.ts src/modules/workspace/components/CollectionSidebar.test.tsx src/modules/workspace/components/AddLinkDialog.test.tsx` — green; `cd front && npx tsc --noEmit` — clean.
- [ ] Live smoke: browse a site → in the sidebar, click **Explore** on a link (e.g. `/docs`) → a spinner shows, then its `/docs/*` sublinks appear in the collection, selectable → select + **Indexer**. Explore on the root link pulls the whole site (capped ~50, toast notes if truncated).

## Self-review notes

- **Spec coverage:** restore crawler → Task 1. crawlSite path filter + endpoint → Task 2. api → Task 3. batch add → Task 4. Explore button → Task 5. wiring → Task 6. Testing → each task's tests + smoke.
- **Restored proven code:** the crawler service + spec come verbatim from `734c6cc90^`; only the return shape (flat) and path filter are new (in `crawlSite`, not the crawler).
- **Type consistency:** `crawl`/`crawlSite`/`crawlUrl` all return `{ pages: { url; title? }[]; truncated }`; `addPages(CollectedPage[]): number`; `onExplore(url)`/`exploring: Set<string>` used identically across Tasks 5/6.
- **DI ripple:** Task 2 adds a `WebsiteCrawlerService` constructor param to `WorkspaceDocumentService` — other specs that build it via `Test.createTestingModule` may need `{ provide: WebsiteCrawlerService, useValue: {} }`; only touch specs that actually break.
