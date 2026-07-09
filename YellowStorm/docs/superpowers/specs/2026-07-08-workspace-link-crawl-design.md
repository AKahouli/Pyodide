# Workspace Link Crawl & Multi-Page Select — Design

**Date:** 2026-07-08
**Branch:** feature/index_web_sources
**Status:** Approved, pending implementation plan
**Builds on:** `2026-07-08-workspace-links-design.md` (the single-link add → convert → index flow, now shipped end-to-end)

## Goal

When a user submits a website URL, let them **discover the site's sub-pages**,
see them in a **checkbox tree** with an optional page preview, and **select one
or many pages to index**. Each selected page then follows the existing pipeline:
convert the page to PDF (Gotenberg wrapper), store it as a `WorkspaceDoc`
(`type='url'`), and queue it for indexing.

## Non-Goals

- No new indexing pipeline. Each selected page reuses the existing
  `convertAndStore` → `queueDocument` flow.
- No async crawl job/queue infrastructure — the crawl is synchronous
  (bounded to ~10s).
- No server-side screenshot preview — preview is a best-effort iframe with a
  reliable "open in new tab" fallback.
- Not a general-purpose web crawler; strict same-domain and hard caps apply.

## Decisions (resolved during brainstorming)

1. **Crawler lives in the Nest backend** (not the DOCS API).
2. **Discovery = sitemap-first, crawl fallback:** robots.txt `Sitemap:` →
   `/sitemap.xml` (+ nested sitemap indexes) → if none, BFS same-host link crawl.
3. **Limits (small/fast):** same-host only, **max 50 pages**, **max depth 2**,
   **~10s time budget**, concurrency ~5, honor `robots.txt` disallow.
4. **Synchronous crawl:** `POST /crawl` blocks up to the budget and returns the
   tree directly (modal spinner).
5. **Preview:** best-effort `<iframe sandbox>` + always-visible "Ouvrir dans un
   onglet" fallback; no attempt to reliably detect framing blocks (unreliable
   cross-origin).
6. **Flow:** crawl-first with a single-page option — the tree's root is
   pre-checked, so a user who only wants the submitted page just clicks Add.
7. **alreadyIndexed marking:** discovered URLs already present as
   `WorkspaceDoc.sourceUrl` in the workspace are flagged (disabled + badge) to
   avoid duplicates.
8. **Throttled bulk conversion** (~3–5 concurrent) so selecting many pages does
   not fire dozens of simultaneous Gotenberg calls.

## Background (existing pieces this reuses)

- `AddLinkDialog` (`front/src/modules/workspace/components/AddLinkDialog.tsx`) —
  currently a single URL field: validate reachability → `addPageLink` →
  `POST /link`.
- `WorkspaceDocumentService.addLink(workspaceId, userId, url)` — creates a
  `type='url'` doc (PROCESSING, unique `link-pending:<id>.pdf` placeholder path),
  fires `convertAndStore` (fire-and-forget).
- `WorkspaceDocumentService.convertAndStore(...)` — `assertUrlIsSafe` → Gotenberg
  convert (form-urlencoded) → upload PDF → status COMPLETED → `queueDocument`;
  on failure sets FAILED + notifies.
- `WorkspaceDocumentService.assertUrlIsSafe(url)` — SSRF guard (rejects
  non-http(s) and private/loopback/link-local/CGNAT + IPv6 ranges via DNS
  lookup). **Reused for the crawl seed and every discovered/fetched URL.**
- `WorkspaceDocumentService.checkUrlReachable(url)` — reachability check used by
  the modal today.
- Classifier `listFiles` surfaces docs of any status with `type`/`sourceUrl`/
  `status`; frontend renders the list + live status.

## Architecture

### Backend — `WebsiteCrawlerService` (new)

`back/src/modules/workspace/services/website-crawler.service.ts`

Responsibility: given a seed URL, discover same-host pages and return a tree.

```
crawl(seedUrl: string, opts?: CrawlLimits): Promise<CrawlResult>
```
- `CrawlLimits = { maxPages: 50, maxDepth: 2, timeBudgetMs: 10_000, concurrency: 5 }`
  (defaults; values come from config so they are tunable).
- `CrawlResult = { pages: DiscoveredPage[], truncated: boolean }`
  where `DiscoveredPage = { url: string, title?: string }`.
  (The tree is built from the flat `pages` list — see "Tree building".)

Algorithm:
1. `assertUrlIsSafe(seedUrl)`; derive the seed's host + registrable domain.
2. **Sitemap discovery:**
   - GET `{origin}/robots.txt` (short timeout, capped size); parse `Sitemap:`
     lines.
   - GET each sitemap URL and `{origin}/sitemap.xml`; parse `<loc>` entries;
     follow nested `<sitemapindex>` one level.
   - Keep only same-host URLs; collect into the candidate set.
3. **Crawl fallback** (only if the sitemap yielded nothing beyond the seed):
   BFS from the seed, fetching each page's HTML (capped size), extracting
   same-host `<a href>` links, to `maxDepth`, respecting `robots.txt` disallow,
   stopping at `maxPages` or `timeBudgetMs`, with a concurrency cap.
4. For every candidate URL: `assertUrlIsSafe` + same-registrable-domain check
   before it is fetched; skip on failure.
5. Extract `<title>` where cheaply available (from crawled HTML; sitemap-only
   URLs may have no title).
6. Dedup (normalize: strip fragments, trailing slash), cap at `maxPages`
   (`truncated=true` if the candidate set was larger; `log()` the drop count —
   no silent truncation).

Notes:
- Uses `axios` with per-request timeout, `maxContentLength`, and `maxRedirects`
  caps. No new dependency for HTML parsing if a lightweight regex/`cheerio`-free
  link extraction suffices; if `cheerio` is already a dependency it may be used
  (the plan verifies before adding anything).
- The service is pure discovery — it does not touch Mongo except the caller does
  the `alreadyIndexed` lookup.

### Backend — crawl endpoint

On `WorkspaceDocumentController`:

`POST /workspaces/:workspaceId/documents/crawl` (body `CrawlUrlDto { url }`,
`WorkspaceAccessGuard`; read-only, no write guard — like `validate-url`).
Handler:
1. `checkUrlReachable(url)` (reuse) → if unreachable, 400/clear error.
2. `websiteCrawler.crawl(url)` → `{ pages, truncated }`.
3. Look up existing `WorkspaceDoc.sourceUrl` values in the workspace; mark each
   page `alreadyIndexed`.
4. Build the tree (see below) and return `{ tree, truncated }`.

Response shape:
```ts
PageNode = { url: string; title?: string; path: string;
             alreadyIndexed: boolean; children: PageNode[] }
CrawlResponse = { tree: PageNode[]; truncated: boolean }
```

### Backend — bulk add endpoint

Generalize `addLink` into `addLinks`:

`POST /workspaces/:workspaceId/documents/links` (body `AddLinksDto { urls: string[] }`,
`WritePermissionGuard`). Handler → `service.addLinks(workspaceId, userId, urls)`:
- One upfront `checkStorageQuota(workspaceId, 0)`.
- For each URL: create a `type='url'` doc (PROCESSING, unique
  `link-pending:<id>.pdf` path), then run `convertAndStore` **with a concurrency
  cap** (~3–5) rather than firing all at once. Skip URLs that fail
  `assertUrlIsSafe` early (record as FAILED or omit — the plan picks one and
  makes it explicit).
- Returns the created `DocumentResponse[]`.
- The existing `addLink(url)` becomes a thin wrapper: `addLinks([url])[0]`
  (keeps the single `POST /link` endpoint working unchanged).

### Tree building

Pure function (backend or shared util): from the flat `pages` list, build
`PageNode[]` by URL path hierarchy. Root = the seed's path; each page nests under
its longest-prefix ancestor by path segments. Pages with no discovered ancestor
attach at the top level. `path` is the display path (e.g. `/docs/guide/intro`).
Deterministic ordering (alphabetical by path) so output is stable/testable.

### Frontend — two-phase `AddLinkDialog`

`front/src/modules/workspace/components/AddLinkDialog.tsx` becomes two phases
(or a new `CrawlLinkDialog` if the file grows too large — the plan decides based
on size; keep components focused):

- **Phase 1 — input:** URL field + **"Cartographier"** button. On click:
  validate format (zod), then `POST /crawl` (spinner up to ~10s). On error
  (unreachable / crawl failed): inline message, stay in phase 1.
- **Phase 2 — tree + preview:**
  - Left: checkbox **tree** (`PageNode` recursive), expand/collapse,
    select-all / none, **root pre-checked**. `alreadyIndexed` rows are shown
    disabled with an "Déjà indexé" badge and are not selectable.
  - Right: **preview pane** for the focused page — `<iframe sandbox src=url>`
    plus an always-visible "Ouvrir dans un onglet" link and a muted note that
    some sites block preview.
  - Footer: **"Ajouter (N)"** (N = selected count, excludes already-indexed) →
    new store action `addPageLinks(workspaceId, urls[])` → `POST /links` →
    `refreshPageData` → toast → close. Disabled when N = 0.

New/changed frontend units:
- `api.ts`: `crawlUrl(workspaceId, url): Promise<CrawlResponse>`,
  `addLinks(workspaceId, urls): Promise<WorkspaceDocument[]>`.
- `config.ts`: `workspaceDocuments.crawl(id)`, `.links(id)`.
- `store.ts`: `addPageLinks(workspaceId, urls)` (mirrors `addPageLink`).
- `types.ts`: `PageNode`, `CrawlResponse`.
- A `PageTree` component (recursive checkbox tree) kept in its own file.

## Security & Politeness

- `assertUrlIsSafe` on the seed and **every** fetched/candidate URL (SSRF).
- Same-registrable-domain restriction on all discovered URLs.
- Respect `robots.txt` disallow for the crawl fallback.
- Hard caps (pages/depth/time/concurrency) are the DoS guard; crawl fetches use
  short timeouts and capped response sizes.
- The crawl endpoint is behind `WorkspaceAccessGuard`; bulk add behind
  `WritePermissionGuard`.

## Error Handling

| Case | Behavior |
|------|----------|
| Invalid URL format | Caught in modal (zod); no request. |
| Unreachable seed | `checkUrlReachable` fails → modal error; no crawl. |
| SSRF / internal host (seed or discovered) | Rejected; seed → 400; discovered → skipped. |
| Sitemap + crawl find only the seed | Tree shows just the root (≡ today's single add). |
| >50 candidates | Capped to 50; `truncated=true`; count logged. |
| Per-page conversion failure | Independent per doc → that doc FAILED (existing behavior). |
| Preview iframe blocked | Silent (blank iframe) — user uses "Ouvrir dans un onglet". |

## Testing

**Backend (Jest):**
- `WebsiteCrawlerService`: robots.txt `Sitemap:` extraction; sitemap.xml + nested
  sitemapindex parse; BFS depth/page/time caps; same-domain filtering; SSRF
  rejection of internal hosts (mock `dns/promises`); dedup/normalization;
  `truncated` flag. All HTTP mocked (mock axios).
- Tree building: nesting by path hierarchy; deterministic order; orphan handling.
- `addLinks`: upfront quota; per-URL doc creation with unique placeholder path;
  concurrency cap invoked; returns created docs; single-`addLink` wrapper intact.
- Crawl endpoint: `alreadyIndexed` marking against existing `sourceUrl`.

**Frontend (Vitest + testing-library):**
- Phase transition (input → tree) on successful crawl; error keeps phase 1.
- Tree selection logic (select-all/none, root pre-checked, already-indexed
  disabled, N count).
- `addPageLinks` store action posts the selected URLs and refreshes.

## Files (summary)

**Backend**
- `services/website-crawler.service.ts` (new) + spec.
- `dto/crawl-url.dto.ts`, `dto/add-links.dto.ts` (new); `dto/index.ts`.
- `workspace-document.controller.ts` — `POST /crawl`, `POST /links`.
- `workspace-document.service.ts` — `addLinks`, `addLink` → wrapper, tree
  build + `alreadyIndexed` lookup (or a small helper), throttled conversion.
- `workspace.module.ts` — register `WebsiteCrawlerService`.
- Config — crawl limits (`indexing.config.ts` or a new namespace).
- `interfaces/workspace-document.interface.ts` — `PageNode`/`CrawlResponse` (or a
  new interface file).

**Frontend**
- `components/AddLinkDialog.tsx` — two-phase (or new `CrawlLinkDialog.tsx`).
- `components/PageTree.tsx` (new) + test.
- `components/AddLinkDialog.test.tsx` — updated.
- `types.ts`, `api.ts`, `store.ts`, `lib/api/config.ts`.
