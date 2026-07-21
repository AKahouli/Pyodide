# Explore / web-crawler — per-link sublink discovery — Design

**Status:** Approved (brainstorming complete) — ready for implementation planning.

## Problem

The navigator collects only pages the user manually clicks to in the live browser. There is no way to auto-discover a link's sublinks. A server-side crawler (`WebsiteCrawlerService`) once did this and "worked perfectly"; it was removed in `734c6cc90` in favor of interactive browsing. We want it back, wired as a per-link **Explore** button.

## Goal

Each collected link in the sidebar gets an **Explore** button that crawls that link, discovers its sublinks (server-side), and adds the ones **under that link's path** to the collection as selectable pages.

## Locked Decisions (from brainstorming)

1. **Engine: resurrect the server-side `WebsiteCrawlerService`** (robots/sitemap-first + BFS fallback, SSRF-safe, capped by config) from history — proven code.
2. **Scope: pages under the clicked link's path.** Explore on `/docs` adds `/docs/*`; Explore on the root path `/` covers the whole site. Filtering is server-side.
3. **Discovered pages are added selectable, not auto-indexed.** They enter the sidebar like browsed pages (auto-selected, deduped); the user still picks and clicks Indexer.
4. **The Explore button sits per collected link** in the sidebar (beside the pencil/trash), with a per-URL loading spinner while crawling.
5. Return a **flat** `{ pages, truncated }` — the sidebar builds its own trie (the old page-tree is not restored).

## Architecture & Data Flow

### Backend (resurrect + adapt)
- **Restore `back/src/modules/workspace/services/website-crawler.service.ts`** and `website-crawler.service.spec.ts` from `git show 734c6cc90^:...`. The service's public method is `crawl(seedUrl: string): Promise<CrawlResult>` where `CrawlResult = { pages: DiscoveredPage[]; truncated: boolean }` and `DiscoveredPage = { url: string; title?: string; depth?: number }`. It fetches `robots.txt` → same-host sitemaps + `/sitemap.xml`, falls back to BFS (SSRF-safe `safeGet`), capped by config.
- **Restore the crawl config keys** in `back/src/config/indexing.config.ts`: `crawlMaxPages` (50), `crawlMaxDepth` (2), `crawlTimeBudgetMs` (10000), `crawlConcurrency` (5), read via `configService.get('indexing.crawl*', default)`.
- **Restore `CrawlUrlDto { url: string }`** (`@IsUrl({ require_protocol: true })`).
- **New service method** `WorkspaceDocumentService.crawlSite(workspaceId, url): Promise<{ pages: DiscoveredPage[]; truncated: boolean }>`:
  - the restored crawler's `safeGet` is itself SSRF-safe (blocks private/link-local hosts and disallowed redirects) — that is the primary defense; `crawlSite` additionally pre-validates the seed is a valid http(s) URL (and may reuse the existing `checkUrlReachable`);
  - call `this.websiteCrawler.crawl(url)`;
  - **filter to the seed's path**: keep pages whose parsed `pathname` starts with the seed's `pathname` (root path `/` → keep all). Compare on normalized/decoded paths; keep exact seed too.
  - return `{ pages: filtered, truncated }`.
- **Endpoint** `POST /workspaces/:workspaceId/documents/crawl` (guarded by `WritePermissionGuard`), body `CrawlUrlDto`, → `crawlSite(workspaceId, body.url)`. Wire `WebsiteCrawlerService` into `workspace.module.ts` providers.

### Frontend
- **`crawlUrl(workspaceId, url)`** in `api.ts` → `POST` to a new `API_ENDPOINTS.workspaceDocuments.crawl(workspaceId)`, returns `{ pages: { url: string; title?: string }[]; truncated: boolean }`.
- **`useBrowserSession.addPages(pages: CollectedPage[]): number`** — batch-add: for each page, skip if `normalizeUrl(url)` already in `seenRef`; otherwise add to `seenRef` and to `pages`. Returns the count added. (Mirrors `addManualPage` but batched; no `manual` flag — crawled pages are ordinary collected pages.)
- **`CollectionSidebar`** — new optional prop `onExplore?: (url: string) => void` and a per-leaf Explore button (a `Compass`/`Waypoints` icon) beside the pencil/trash, rendered only when `onExplore` is given. A `Set<string>` of in-flight URLs (owned by the sidebar or passed in) drives a spinner + disables that leaf's button while crawling.
- **`AddLinkDialog`** — passes `onExplore={handleExplore}` to the sidebar:
  ```ts
  const [exploring, setExploring] = useState<Set<string>>(new Set());
  const handleExplore = async (url: string) => {
    setExploring((p) => new Set(p).add(url));
    try {
      const { pages, truncated } = await crawlUrl(workspaceId, url);
      const added = session.addPages(pages.map((p) => ({ url: p.url, title: p.title ?? '' })));
      toast.success(`${added} page(s) trouvée(s)${truncated ? ' (limite atteinte)' : ''}`);
    } catch { toast.error("L'exploration a échoué."); }
    finally { setExploring((p) => { const n = new Set(p); n.delete(url); return n; }); }
  };
  ```
  Discovered pages are auto-selected via the existing new-page selection effect (they carry no `indexingStatus`, so no dot; they're not in `indexedUrls`, so selectable).

## Edge Cases

- **Crawl returns nothing / times out** → `added` is 0; toast "0 page(s) trouvée(s)". No error.
- **Discovered page already collected** → deduped by `seenRef` (not re-added, not double-counted).
- **`truncated`** (hit the 50-page cap) → toast notes the limit.
- **SSRF / unsafe URL** → the safety guard rejects before crawling; endpoint returns an error → toast "échoué".
- **Explore is independent of the live browser** — server-side HTTP, so it works on any collected link regardless of the current page in the viewer.
- **Continue mode (Batch B) seeded pages** also get an Explore button; crawling from an already-indexed link adds NEW sublinks (not the indexed ones, which dedupe if re-discovered but keep their status — acceptable; a re-discovered indexed URL stays deduped by `seenRef`).

## Testing

**Backend:**
- Restore `website-crawler.service.spec.ts` (its original coverage of sitemap/BFS/caps).
- `crawlSite` returns only pages under the seed path (path-filter test): given a crawler stub returning `/docs/a`, `/pricing`, seed `/docs` → only `/docs/a`; seed `/` → both.
- `crawlSite` rejects an unsafe URL via the guard.

**Frontend:**
- `useBrowserSession.addPages` adds new pages, dedups already-seen ones, returns the added count.
- `CollectionSidebar` renders an Explore button per leaf and calls `onExplore(url)`; shows a spinner for an in-flight URL.
- `AddLinkDialog.handleExplore` calls `crawlUrl` and `session.addPages` with the discovered pages (mock `crawlUrl`).

## Out of Scope

- Restoring the old page-tree / two-phase crawl-tree dialog (the sidebar trie replaces it).
- Recursive "explore everything" / auto-indexing discovered pages.
- Client-side path filtering (done server-side).
- Live crawl progress streaming (single request/response).

## Global Constraints

- TDD: failing test first, minimal implementation, then commit.
- Conventional commits: `<type>(<scope>): <subject>`. **No `Co-Authored-By` trailer.**
- Colocated tests (`X.spec.ts` backend, `X.test.ts(x)` frontend).
- Restore the crawler service verbatim from history where possible; adapt only the return shape (flat) + add the path filter.
- Reuse the existing workspace URL-safety guard; keep the crawler SSRF-safe.
