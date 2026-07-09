# Workspace Link Crawl & Multi-Page Select — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user submit a website URL, discover its sub-pages (sitemap-first, crawl fallback), pick pages from a checkbox tree with an iframe preview, and index each selected page through the existing convert→PDF→index flow.

**Architecture:** A new dependency-free `WebsiteCrawlerService` (Nest backend) discovers same-host pages under strict caps. A `POST /crawl` endpoint returns a page tree (with `alreadyIndexed` marks); a `POST /links` bulk endpoint creates a `type='url'` doc per selected URL and runs the existing `convertAndStore` with a concurrency cap. The frontend `AddLinkDialog` becomes two-phase (URL input → tree + preview). The SSRF guard is extracted into a shared util reused by both the doc service and the crawler.

**Tech Stack:** NestJS + Mongoose + axios (backend, Jest); React + TS + Vite + Zustand + lucide-react (frontend, Vitest + @testing-library/react). No new npm dependencies.

## Global Constraints

- Backend tests: `cd back && npx jest <file>` (Jest). Frontend tests: `cd front && npx vitest run <file>` (Vitest).
- No new npm dependencies. Parse sitemap/robots/HTML with regex + string ops; implement a small inline concurrency limiter.
- Crawl limits (defaults, from config, tunable): `maxPages: 50`, `maxDepth: 2`, `timeBudgetMs: 10_000`, `concurrency: 5`. Same registrable-domain only. Honor `robots.txt` disallow in the crawl fallback.
- Every seed AND every discovered/fetched URL passes the SSRF guard (`assertUrlIsSafe`) before it is fetched or indexed.
- Bulk conversion concurrency cap: `3`.
- A URL doc is created with `type='url'`, `status=PROCESSING`, `indexingStatus=NONE`, and a unique placeholder path `link-pending:<documentId>.pdf` (existing invariant — the collection has a unique `path` index).
- UI copy is French.
- Commit after each task with the message in its final step.

---

### Task 1: Extract the SSRF guard into a shared util

The crawler must reuse the SSRF logic currently living as private methods on `WorkspaceDocumentService`. Extract it into a pure, testable module; keep the service delegating so existing tests pass.

**Files:**
- Create: `back/src/modules/workspace/services/url-safety.ts`
- Create: `back/src/modules/workspace/services/url-safety.spec.ts`
- Modify: `back/src/modules/workspace/workspace-document.service.ts`

**Interfaces:**
- Produces: `export async function assertUrlIsSafe(url: string): Promise<void>` (throws `Error` — see note — on non-http(s) or private/loopback/link-local/CGNAT/IPv6 addresses). `export function isPrivateIpv4Address(ip: string): boolean`, `export function isPrivateIpv6Address(ip: string): boolean` (for unit tests).

- [ ] **Step 1: Write the util test (mock DNS)**

Create `url-safety.spec.ts`:

```ts
import { assertUrlIsSafe, isPrivateIpv4Address, isPrivateIpv6Address } from './url-safety';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));
import { lookup } from 'dns/promises';
const mockLookup = lookup as jest.MockedFunction<typeof lookup>;

describe('url-safety', () => {
  beforeEach(() => mockLookup.mockReset());

  it('flags private IPv4 ranges', () => {
    ['10.0.0.1', '172.16.5.4', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']
      .forEach((ip) => expect(isPrivateIpv4Address(ip)).toBe(true));
    ['8.8.8.8', '1.1.1.1', '93.184.216.34'].forEach((ip) => expect(isPrivateIpv4Address(ip)).toBe(false));
  });

  it('flags private IPv6 ranges', () => {
    ['::1', '::', 'fc00::1', 'fd12::3', 'fe80::1', '::ffff:127.0.0.1']
      .forEach((ip) => expect(isPrivateIpv6Address(ip)).toBe(true));
    ['2606:4700:4700::1111'].forEach((ip) => expect(isPrivateIpv6Address(ip)).toBe(false));
  });

  it('rejects non-http(s) and localhost', async () => {
    await expect(assertUrlIsSafe('ftp://x.com')).rejects.toThrow();
    await expect(assertUrlIsSafe('http://localhost/x')).rejects.toThrow();
    await expect(assertUrlIsSafe('not a url')).rejects.toThrow();
  });

  it('rejects a host resolving to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as any);
    await expect(assertUrlIsSafe('http://evil.test/')).rejects.toThrow(/disallowed/i);
  });

  it('allows a host resolving to a public address', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    await expect(assertUrlIsSafe('https://example.com/')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd back && npx jest url-safety.spec.ts`
Expected: FAIL ("Cannot find module './url-safety'").

- [ ] **Step 3: Create the util by moving the existing logic**

Create `url-safety.ts` containing the SSRF logic currently in `workspace-document.service.ts` (the `assertUrlIsSafe` method plus `ipv4ToInt`, `isIpv4InCidr`, `isPrivateIpv4Address`, `firstIpv6Hextet`, `isPrivateIpv6Address`). Convert them from private methods to module functions. Use a `BadRequestException` from `@nestjs/common` for the throws (keep the same messages) so HTTP callers still get 400:

```ts
import { BadRequestException } from '@nestjs/common';
import { lookup } from 'dns/promises';

export async function assertUrlIsSafe(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('Only http(s) URLs are allowed');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Only http(s) URLs are allowed');
  }
  const hostname = parsed.hostname;
  if (hostname.toLowerCase() === 'localhost') {
    throw new BadRequestException('URL resolves to a disallowed (private/internal) address');
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BadRequestException('Unable to resolve host for the provided URL');
  }
  const disallowed = addresses.some(({ address, family }) =>
    family === 6 ? isPrivateIpv6Address(address) : isPrivateIpv4Address(address),
  );
  if (disallowed) {
    throw new BadRequestException('URL resolves to a disallowed (private/internal) address');
  }
}
```

Copy the four IP helpers verbatim from `workspace-document.service.ts` (lines defining `ipv4ToInt`, `isIpv4InCidr`, `isPrivateIpv4Address`, `firstIpv6Hextet`, `isPrivateIpv6Address`) into this module as functions, and `export` `isPrivateIpv4Address` and `isPrivateIpv6Address`.

- [ ] **Step 4: Delegate from the service**

In `workspace-document.service.ts`, replace the body of the private `assertUrlIsSafe` method (keep the method so existing internal calls and the service spec's SSRF tests still work) with a delegation, and delete the now-unused private IP helper methods:

```ts
import { assertUrlIsSafe as assertUrlSafe } from './services/url-safety';
// ...
private async assertUrlIsSafe(url: string): Promise<void> {
  return assertUrlSafe(url);
}
```

Delete the private `ipv4ToInt`/`isIpv4InCidr`/`isPrivateIpv4Address`/`firstIpv6Hextet`/`isPrivateIpv6Address` methods (now in the util). Keep the `import { lookup } from 'dns/promises'` only if still used elsewhere in the service (it is not after this — remove it if unused to avoid a lint error).

- [ ] **Step 5: Run util + service specs**

Run: `cd back && npx jest url-safety.spec.ts workspace-document.service.spec.ts`
Expected: PASS (util 5 tests; service spec including its existing 7 SSRF tests still green — they exercise the delegating method). Then `cd back && npx tsc --noEmit -p tsconfig.json` clean.

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/workspace/services/url-safety.ts back/src/modules/workspace/services/url-safety.spec.ts back/src/modules/workspace/workspace-document.service.ts
git commit -m "refactor(workspace): extract SSRF url-safety guard into a shared util"
```

---

### Task 2: `WebsiteCrawlerService` — discovery

**Files:**
- Create: `back/src/modules/workspace/services/website-crawler.service.ts`
- Create: `back/src/modules/workspace/services/website-crawler.service.spec.ts`
- Modify: `back/src/config/indexing.config.ts` (crawl limits)

**Interfaces:**
- Consumes: `assertUrlIsSafe` (Task 1).
- Produces: `interface DiscoveredPage { url: string; title?: string }`; `interface CrawlResult { pages: DiscoveredPage[]; truncated: boolean }`; `class WebsiteCrawlerService { async crawl(seedUrl: string): Promise<CrawlResult> }`.

- [ ] **Step 1: Add crawl-limit config**

In `back/src/config/indexing.config.ts`, add inside the returned object:

```ts
  crawlMaxPages: Number.parseInt(process.env.CRAWL_MAX_PAGES || '50', 10),
  crawlMaxDepth: Number.parseInt(process.env.CRAWL_MAX_DEPTH || '2', 10),
  crawlTimeBudgetMs: Number.parseInt(process.env.CRAWL_TIME_BUDGET_MS || '10000', 10),
  crawlConcurrency: Number.parseInt(process.env.CRAWL_CONCURRENCY || '5', 10),
```

- [ ] **Step 2: Write the crawler spec (mock axios)**

Create `website-crawler.service.spec.ts`. Mock `axios` and `dns/promises` (the SSRF guard resolves DNS). Provide a `ConfigService` stub returning the limits and a logger stub. Cover: sitemap discovery, crawl fallback, same-host filtering, page cap + `truncated`, and SSRF rejection of the seed.

```ts
import { WebsiteCrawlerService } from './website-crawler.service';
import axios from 'axios';

jest.mock('axios');
jest.mock('dns/promises', () => ({ lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) }));
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeService(overrides: Record<string, number> = {}) {
  const limits: Record<string, number> = {
    'indexing.crawlMaxPages': 50, 'indexing.crawlMaxDepth': 2,
    'indexing.crawlTimeBudgetMs': 10000, 'indexing.crawlConcurrency': 5, ...overrides,
  };
  const config = { get: (k: string, d?: unknown) => (k in limits ? limits[k] : d) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return new WebsiteCrawlerService(config as any, logger as any);
}

const ok = (data: unknown, headers: Record<string, string> = {}) => ({ status: 200, data, headers });

describe('WebsiteCrawlerService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('discovers pages from sitemap.xml (same-host only)', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/robots.txt')) return ok('Sitemap: https://ex.com/sitemap.xml');
      if (url.endsWith('/sitemap.xml')) return ok(
        '<urlset><url><loc>https://ex.com/a</loc></url><url><loc>https://ex.com/b</loc></url>' +
        '<url><loc>https://other.com/x</loc></url></urlset>', { 'content-type': 'application/xml' });
      return ok('<html></html>');
    });
    const res = await makeService().crawl('https://ex.com/');
    const urls = res.pages.map((p) => p.url).sort();
    expect(urls).toContain('https://ex.com/a');
    expect(urls).toContain('https://ex.com/b');
    expect(urls.some((u) => u.includes('other.com'))).toBe(false);
  });

  it('falls back to link-crawl when no sitemap, respecting maxPages', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/robots.txt')) return { status: 404, data: '', headers: {} };
      if (url.endsWith('/sitemap.xml')) return { status: 404, data: '', headers: {} };
      // seed page links to /p1.. /p5
      return ok('<html><body>' +
        [1,2,3,4,5].map((n) => `<a href="https://ex.com/p${n}">p${n}</a>`).join('') +
        '</body></html>', { 'content-type': 'text/html' });
    });
    const res = await makeService({ 'indexing.crawlMaxPages': 3 }).crawl('https://ex.com/');
    expect(res.pages.length).toBeLessThanOrEqual(3);
    expect(res.truncated).toBe(true);
  });

  it('rejects an unsafe seed (SSRF)', async () => {
    const dns = require('dns/promises');
    dns.lookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    await expect(makeService().crawl('http://internal.test/')).rejects.toThrow(/disallowed/i);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `cd back && npx jest website-crawler.service.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the crawler**

Create `website-crawler.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { LoggerService } from '../../logger';
import { assertUrlIsSafe } from './url-safety';

export interface DiscoveredPage {
  url: string;
  title?: string;
}
export interface CrawlResult {
  pages: DiscoveredPage[];
  truncated: boolean;
}

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 2 * 1024 * 1024;

@Injectable()
export class WebsiteCrawlerService {
  private readonly maxPages: number;
  private readonly maxDepth: number;
  private readonly timeBudgetMs: number;
  private readonly concurrency: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WebsiteCrawlerService');
    this.maxPages = this.configService.get<number>('indexing.crawlMaxPages', 50);
    this.maxDepth = this.configService.get<number>('indexing.crawlMaxDepth', 2);
    this.timeBudgetMs = this.configService.get<number>('indexing.crawlTimeBudgetMs', 10000);
    this.concurrency = this.configService.get<number>('indexing.crawlConcurrency', 5);
  }

  async crawl(seedUrl: string): Promise<CrawlResult> {
    await assertUrlIsSafe(seedUrl);
    const seed = new URL(seedUrl);
    const host = seed.host;
    const deadline = Date.now() + this.timeBudgetMs;

    // 1. Sitemap-first discovery.
    const disallow = await this.fetchDisallowRules(seed.origin, deadline);
    let urls = await this.discoverViaSitemap(seed.origin, host, deadline);

    let pages: DiscoveredPage[];
    if (urls.length > 0) {
      pages = urls.map((url) => ({ url }));
    } else {
      // 2. Crawl fallback (BFS), collecting titles.
      pages = await this.crawlFallback(seed, host, disallow, deadline);
    }

    // Always include the seed itself.
    const norm = (u: string) => this.normalize(u);
    const seen = new Set<string>();
    const deduped: DiscoveredPage[] = [];
    for (const p of [{ url: this.normalize(seedUrl) }, ...pages]) {
      const key = norm(p.url);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(p);
    }

    const truncated = deduped.length > this.maxPages;
    if (truncated) {
      this.logger.warn('Crawl result truncated', {
        host, found: deduped.length, cap: this.maxPages,
      });
    }
    return { pages: deduped.slice(0, this.maxPages), truncated };
  }

  private normalize(u: string): string {
    try {
      const url = new URL(u);
      url.hash = '';
      let s = url.toString();
      if (s.endsWith('/') && url.pathname !== '/') s = s.slice(0, -1);
      return s;
    } catch {
      return u;
    }
  }

  private async safeGet(url: string, deadline: number): Promise<string | null> {
    if (Date.now() > deadline) return null;
    try {
      await assertUrlIsSafe(url);
      const res = await axios.get(url, {
        timeout: Math.min(FETCH_TIMEOUT_MS, Math.max(0, deadline - Date.now())),
        maxContentLength: MAX_BYTES,
        maxRedirects: 5,
        responseType: 'text',
        validateStatus: (s) => s >= 200 && s < 300,
        transformResponse: (d) => d,
      });
      return typeof res.data === 'string' ? res.data : String(res.data);
    } catch {
      return null;
    }
  }

  private async fetchDisallowRules(origin: string, deadline: number): Promise<string[]> {
    const body = await this.safeGet(`${origin}/robots.txt`, deadline);
    if (!body) return [];
    const rules: string[] = [];
    let appliesToAll = false;
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      const lower = line.toLowerCase();
      if (lower.startsWith('user-agent:')) appliesToAll = line.split(':')[1].trim() === '*';
      else if (appliesToAll && lower.startsWith('disallow:')) {
        const path = line.slice(line.indexOf(':') + 1).trim();
        if (path) rules.push(path);
      }
    }
    return rules;
  }

  private async discoverViaSitemap(origin: string, host: string, deadline: number): Promise<string[]> {
    // robots Sitemap: lines + default /sitemap.xml
    const robots = await this.safeGet(`${origin}/robots.txt`, deadline);
    const sitemapUrls = new Set<string>();
    if (robots) {
      for (const raw of robots.split('\n')) {
        const line = raw.trim();
        if (line.toLowerCase().startsWith('sitemap:')) {
          sitemapUrls.add(line.slice(line.indexOf(':') + 1).trim());
        }
      }
    }
    sitemapUrls.add(`${origin}/sitemap.xml`);

    const found = new Set<string>();
    const nested: string[] = [];
    for (const sm of sitemapUrls) {
      if (Date.now() > deadline || found.size >= this.maxPages) break;
      const xml = await this.safeGet(sm, deadline);
      if (!xml) continue;
      const locs = this.extractLocs(xml);
      const isIndex = /<sitemapindex/i.test(xml);
      for (const loc of locs) {
        if (isIndex) nested.push(loc);
        else if (this.sameHost(loc, host)) found.add(this.normalize(loc));
      }
    }
    // Follow nested sitemaps one level.
    for (const sm of nested) {
      if (Date.now() > deadline || found.size >= this.maxPages) break;
      const xml = await this.safeGet(sm, deadline);
      if (!xml) continue;
      for (const loc of this.extractLocs(xml)) {
        if (this.sameHost(loc, host)) found.add(this.normalize(loc));
      }
    }
    return [...found];
  }

  private extractLocs(xml: string): string[] {
    const out: string[] = [];
    const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
    return out;
  }

  private sameHost(u: string, host: string): boolean {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  }

  private isDisallowed(url: string, rules: string[]): boolean {
    try {
      const path = new URL(url).pathname;
      return rules.some((r) => path.startsWith(r));
    } catch {
      return false;
    }
  }

  private async crawlFallback(
    seed: URL, host: string, disallow: string[], deadline: number,
  ): Promise<DiscoveredPage[]> {
    const visited = new Set<string>([this.normalize(seed.toString())]);
    const results: DiscoveredPage[] = [];
    let frontier: string[] = [seed.toString()];

    for (let depth = 0; depth <= this.maxDepth; depth++) {
      if (frontier.length === 0 || Date.now() > deadline || visited.size >= this.maxPages) break;
      const next: string[] = [];
      await mapWithConcurrency(frontier, this.concurrency, async (pageUrl) => {
        if (Date.now() > deadline || results.length >= this.maxPages) return;
        const html = await this.safeGet(pageUrl, deadline);
        if (html === null) return;
        results.push({ url: this.normalize(pageUrl), title: this.extractTitle(html) });
        if (depth === this.maxDepth) return;
        for (const link of this.extractLinks(html, pageUrl)) {
          const n = this.normalize(link);
          if (visited.has(n) || !this.sameHost(link, host) || this.isDisallowed(link, disallow)) continue;
          if (visited.size >= this.maxPages) break;
          visited.add(n);
          next.push(link);
        }
      });
      frontier = next;
    }
    return results;
  }

  private extractTitle(html: string): string | undefined {
    const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
    return m ? m[1].trim() : undefined;
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const out: string[] = [];
    const re = /<a\b[^>]*\shref\s*=\s*["']([^"'#]+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        out.push(new URL(m[1], baseUrl).toString());
      } catch {
        // skip malformed href
      }
    }
    return out;
  }
}

/** Dependency-free concurrency limiter: runs fn over items, max `limit` at once. */
async function mapWithConcurrency<T>(
  items: T[], limit: number, fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}
```

- [ ] **Step 5: Run the crawler spec + tsc**

Run: `cd back && npx jest website-crawler.service.spec.ts` → PASS (3 tests). Then `cd back && npx tsc --noEmit -p tsconfig.json` clean.

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/workspace/services/website-crawler.service.ts back/src/modules/workspace/services/website-crawler.service.spec.ts back/src/config/indexing.config.ts
git commit -m "feat(workspace): add WebsiteCrawlerService (sitemap-first, crawl fallback)"
```

---

### Task 3: Tree builder util + `alreadyIndexed`

**Files:**
- Create: `back/src/modules/workspace/services/page-tree.ts`
- Create: `back/src/modules/workspace/services/page-tree.spec.ts`

**Interfaces:**
- Consumes: `DiscoveredPage` (Task 2).
- Produces: `interface PageNode { url: string; title?: string; path: string; alreadyIndexed: boolean; children: PageNode[] }`; `export function buildPageTree(pages: DiscoveredPage[], indexedUrls: Set<string>): PageNode[]`.

- [ ] **Step 1: Write the tree-builder test**

Create `page-tree.spec.ts`:

```ts
import { buildPageTree } from './page-tree';

describe('buildPageTree', () => {
  it('nests pages by URL path hierarchy, deterministic order', () => {
    const pages = [
      { url: 'https://ex.com/docs/guide/intro' },
      { url: 'https://ex.com/docs' },
      { url: 'https://ex.com/docs/guide' },
      { url: 'https://ex.com/' },
    ];
    const tree = buildPageTree(pages, new Set());
    // Root '/' at top; '/docs' nested under it; '/docs/guide' under '/docs'; '/docs/guide/intro' under that.
    const root = tree.find((n) => n.path === '/')!;
    expect(root).toBeDefined();
    const docs = root.children.find((n) => n.path === '/docs')!;
    expect(docs).toBeDefined();
    const guide = docs.children.find((n) => n.path === '/docs/guide')!;
    expect(guide.children.some((n) => n.path === '/docs/guide/intro')).toBe(true);
  });

  it('marks alreadyIndexed from the provided set', () => {
    const tree = buildPageTree(
      [{ url: 'https://ex.com/a' }, { url: 'https://ex.com/b' }],
      new Set(['https://ex.com/a']),
    );
    const flat: Record<string, boolean> = {};
    const walk = (ns: any[]) => ns.forEach((n) => { flat[n.url] = n.alreadyIndexed; walk(n.children); });
    walk(tree);
    expect(flat['https://ex.com/a']).toBe(true);
    expect(flat['https://ex.com/b']).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd back && npx jest page-tree.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the tree builder**

Create `page-tree.ts`:

```ts
import { DiscoveredPage } from './website-crawler.service';

export interface PageNode {
  url: string;
  title?: string;
  path: string;
  alreadyIndexed: boolean;
  children: PageNode[];
}

/**
 * Build a tree of pages by URL path hierarchy. Each page nests under the
 * deepest already-present ancestor by path segments; pages with no present
 * ancestor attach at the top level. Deterministic (sorted by path).
 */
export function buildPageTree(pages: DiscoveredPage[], indexedUrls: Set<string>): PageNode[] {
  const nodes: PageNode[] = pages
    .map((p) => {
      let path = '/';
      try { path = new URL(p.url).pathname || '/'; } catch { /* keep '/' */ }
      return { url: p.url, title: p.title, path, alreadyIndexed: indexedUrls.has(p.url), children: [] as PageNode[] };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const byPath = new Map<string, PageNode>();
  for (const n of nodes) if (!byPath.has(n.path)) byPath.set(n.path, n);

  const roots: PageNode[] = [];
  for (const n of nodes) {
    const parent = findParent(n.path, byPath);
    if (parent && parent !== n) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

function findParent(path: string, byPath: Map<string, PageNode>): PageNode | undefined {
  const segments = path.replace(/\/+$/, '').split('/').filter(Boolean);
  for (let i = segments.length - 1; i >= 1; i--) {
    const ancestor = '/' + segments.slice(0, i).join('/');
    const hit = byPath.get(ancestor);
    if (hit) return hit;
  }
  // Fall back to the root '/' if present and this isn't itself '/'.
  if (path !== '/') return byPath.get('/');
  return undefined;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd back && npx jest page-tree.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/workspace/services/page-tree.ts back/src/modules/workspace/services/page-tree.spec.ts
git commit -m "feat(workspace): add page-tree builder with alreadyIndexed marking"
```

---

### Task 4: Bulk `addLinks` + `addLink` wrapper (service)

**Files:**
- Modify: `back/src/modules/workspace/workspace-document.service.ts`
- Modify: `back/src/modules/workspace/workspace-document.service.spec.ts`

**Interfaces:**
- Produces: `async addLinks(workspaceId: string, userId: string, urls: string[]): Promise<DocumentResponse[]>`; `addLink` becomes `return (await this.addLinks(workspaceId, userId, [url]))[0]`.

- [ ] **Step 1: Write the bulk test**

Add to `workspace-document.service.spec.ts` (in the `addLink` describe block, reuse its mocks):

```ts
  it('addLinks creates one processing url doc per URL with a unique path', async () => {
    (service as any).resolveUniqueOriginalName = jest.fn(async (_ws, name) => name);
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);
    const created: any[] = [];
    (documentModel.create as jest.Mock).mockImplementation(async (doc: any) => {
      const d = { ...doc, _id: { toString: () => String(created.length + 1) },
        workspaceId: { toString: () => 'ws1' }, createdBy: { toString: () => 'u1' },
        createdAt: new Date(), updatedAt: new Date() };
      created.push(d);
      return d;
    });

    const res = await service.addLinks(WS_ID, USER_ID, ['https://a.com/x', 'https://b.com/y']);
    expect(res).toHaveLength(2);
    expect(created).toHaveLength(2);
    // Each doc gets a unique link-pending path.
    const paths = created.map((d) => d.path);
    expect(new Set(paths).size).toBe(2);
    paths.forEach((p) => expect(p).toContain('link-pending:'));
    expect((service as any).convertAndStore).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd back && npx jest workspace-document.service.spec.ts -t "addLinks creates one"` → FAIL (`addLinks` not a function).

- [ ] **Step 3: Implement `addLinks` and make `addLink` a wrapper**

In `workspace-document.service.ts`, replace the existing `addLink` method body so it delegates, and add `addLinks`. `addLinks` does one upfront quota check, creates each doc (mirroring the current `addLink` create), then runs `convertAndStore` with a concurrency cap of 3. Keep the exact same doc fields/placeholder path as the current `addLink`:

```ts
async addLink(workspaceId: string, userId: string, url: string): Promise<DocumentResponse> {
  const [doc] = await this.addLinks(workspaceId, userId, [url]);
  return doc;
}

async addLinks(
  workspaceId: string,
  userId: string,
  urls: string[],
): Promise<DocumentResponse[]> {
  const quota = await this.workspaceService.checkStorageQuota(workspaceId, 0);
  if (!quota.allowed) {
    throw new ForbiddenException(
      ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
      `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB`,
    );
  }

  // Create all docs first (fast; each PROCESSING with a unique placeholder path).
  const created: Array<{ response: DocumentResponse; id: string; url: string; name: string }> = [];
  for (const url of urls) {
    const filename = this.deriveFilenameFromUrl(url);
    const effectiveName = await this.resolveUniqueOriginalName(workspaceId, filename);
    const documentId = new Types.ObjectId();
    const document = await this.documentModel.create({
      _id: documentId,
      originalName: effectiveName,
      mimeType: 'application/pdf',
      size: 0,
      type: DocumentType.URL,
      sourceUrl: url,
      path: `link-pending:${documentId}.pdf`,
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.PROCESSING,
      indexingStatus: IndexingStatus.NONE,
    });
    created.push({
      response: this.mapToResponse(document),
      id: document._id.toString(),
      url,
      name: effectiveName,
    });
  }

  // Convert with a concurrency cap so we don't hammer Gotenberg.
  const CONCURRENCY = 3;
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, created.length) }, async () => {
    while (i < created.length) {
      const item = created[i++];
      await this.convertAndStore(item.id, workspaceId, item.url, item.name).catch((err) => {
        this.logger.error('convertAndStore failed', {
          documentId: item.id,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }
  });
  // Fire-and-forget the whole conversion batch; respond as soon as docs exist.
  void Promise.all(workers);

  return created.map((c) => c.response);
}
```

Remove the old single-URL `addLink` body (the quota check + create + fire `convertAndStore`) — it now lives in `addLinks`.

- [ ] **Step 4: Run tests**

Run: `cd back && npx jest workspace-document.service.spec.ts` → PASS (existing `addLink` tests still green via the wrapper, plus the new `addLinks` test). Then `cd back && npx tsc --noEmit -p tsconfig.json` clean.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/workspace/workspace-document.service.ts back/src/modules/workspace/workspace-document.service.spec.ts
git commit -m "feat(workspace): bulk addLinks with throttled conversion; addLink delegates"
```

---

### Task 5: DTOs, crawl + bulk endpoints, module wiring

**Files:**
- Create: `back/src/modules/workspace/dto/crawl-url.dto.ts`, `back/src/modules/workspace/dto/add-links.dto.ts`
- Modify: `back/src/modules/workspace/dto/index.ts`
- Modify: `back/src/modules/workspace/workspace-document.controller.ts`
- Modify: `back/src/modules/workspace/workspace-document.service.ts` (a `crawl` orchestration method)
- Modify: `back/src/modules/workspace/workspace.module.ts`

**Interfaces:**
- Consumes: `WebsiteCrawlerService.crawl` (T2), `buildPageTree` (T3), `addLinks` (T4), `checkUrlReachable` (existing).
- Produces: `CrawlUrlDto { url }`, `AddLinksDto { urls: string[] }`; `WorkspaceDocumentService.crawlSite(workspaceId, url): Promise<{ tree: PageNode[]; truncated: boolean }>`; `POST /crawl`, `POST /links`.

- [ ] **Step 1: Create the DTOs**

`dto/crawl-url.dto.ts`:
```ts
import { IsUrl } from 'class-validator';
export class CrawlUrlDto {
  @IsUrl({ require_protocol: true }, { message: 'url must be a valid http(s) URL' })
  url!: string;
}
```
`dto/add-links.dto.ts`:
```ts
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUrl } from 'class-validator';
export class AddLinksDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUrl({ require_protocol: true }, { each: true, message: 'each url must be a valid http(s) URL' })
  urls!: string[];
}
```
Add both to `dto/index.ts` (`export * from './crawl-url.dto';` / `./add-links.dto`).

- [ ] **Step 2: Add the `crawlSite` orchestration to the service**

In `workspace-document.service.ts`, inject `WebsiteCrawlerService` (constructor param `private readonly websiteCrawler: WebsiteCrawlerService`) and import `buildPageTree`, `PageNode`. Add:

```ts
async crawlSite(
  workspaceId: string,
  url: string,
): Promise<{ tree: PageNode[]; truncated: boolean }> {
  const { pages, truncated } = await this.websiteCrawler.crawl(url);
  // Mark pages already indexed in this workspace (by sourceUrl).
  const existing = await this.documentModel
    .find({ workspaceId: new Types.ObjectId(workspaceId), type: DocumentType.URL })
    .select({ sourceUrl: 1 })
    .lean()
    .exec();
  const indexed = new Set<string>(
    existing.map((d) => (d as { sourceUrl?: string }).sourceUrl).filter(Boolean) as string[],
  );
  return { tree: buildPageTree(pages, indexed), truncated };
}
```

- [ ] **Step 3: Add the endpoints**

In `workspace-document.controller.ts`, import `CrawlUrlDto`, `AddLinksDto`, and add:

```ts
@Post('crawl')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Discover a website\'s sub-pages for selective indexing' })
@ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
async crawl(
  @Param('workspaceId') workspaceId: string,
  @Body() body: CrawlUrlDto,
) {
  // Reachability first (clear error), then discover.
  const reach = await this.workspaceDocumentService.checkUrlReachable(body.url);
  if (!reach.reachable) {
    return { tree: [], truncated: false, unreachable: true };
  }
  return this.workspaceDocumentService.crawlSite(workspaceId, body.url);
}

@Post('links')
@UseGuards(WritePermissionGuard)
@ApiOperation({ summary: 'Add multiple website links (each converted to PDF and indexed)' })
@ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
async addLinks(
  @CurrentUser() user: UserDocument,
  @Param('workspaceId') workspaceId: string,
  @Body() body: AddLinksDto,
) {
  return this.workspaceDocumentService.addLinks(
    workspaceId,
    user._id.toString(),
    body.urls,
  );
}
```

- [ ] **Step 4: Register `WebsiteCrawlerService` in the module**

In `workspace.module.ts`, import it and add to `providers`:
```ts
import { WebsiteCrawlerService } from './services/website-crawler.service';
// ...
    WebsiteCrawlerService,
```

- [ ] **Step 5: Verify compile + DI**

Run: `cd back && npx tsc --noEmit -p tsconfig.json` clean; then `cd back && npm test` — full suite passes with no DI resolution errors (proves `WebsiteCrawlerService` resolves in the module graph).

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/workspace/dto/crawl-url.dto.ts back/src/modules/workspace/dto/add-links.dto.ts back/src/modules/workspace/dto/index.ts back/src/modules/workspace/workspace-document.controller.ts back/src/modules/workspace/workspace-document.service.ts back/src/modules/workspace/workspace.module.ts
git commit -m "feat(workspace): add crawl and bulk-links endpoints + module wiring"
```

---

### Task 6: Frontend types, API, config, store

**Files:**
- Modify: `front/src/modules/workspace/types.ts`
- Modify: `front/src/lib/api/config.ts`
- Modify: `front/src/modules/workspace/api.ts`
- Modify: `front/src/modules/workspace/store.ts`
- Test: `front/src/modules/workspace/api.crawl.test.ts` (new)

**Interfaces:**
- Produces: `PageNode`, `CrawlResponse` types; `API_ENDPOINTS.workspaceDocuments.crawl(id)`, `.links(id)`; `crawlUrl(workspaceId, url): Promise<CrawlResponse>`; `addLinks(workspaceId, urls): Promise<WorkspaceDocument[]>`; store `addPageLinks(workspaceId, urls): Promise<void>`.

- [ ] **Step 1: Add types**

In `types.ts`:
```ts
export interface PageNode {
  url: string;
  title?: string;
  path: string;
  alreadyIndexed: boolean;
  children: PageNode[];
}
export interface CrawlResponse {
  tree: PageNode[];
  truncated: boolean;
  unreachable?: boolean;
}
```

- [ ] **Step 2: Add endpoints**

In `config.ts` `workspaceDocuments`:
```ts
    crawl: (workspaceId: string) => `/workspaces/${workspaceId}/documents/crawl`,
    links: (workspaceId: string) => `/workspaces/${workspaceId}/documents/links`,
```

- [ ] **Step 3: Write the api test**

Create `api.crawl.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/api/client', () => { const post = vi.fn(); return { default: { post } }; });
import apiClient from '@/lib/api/client';
import { crawlUrl, addLinks } from './api';
const post = (apiClient as unknown as { post: ReturnType<typeof vi.fn> }).post;

describe('crawl api', () => {
  beforeEach(() => post.mockReset());
  it('crawlUrl posts the url and returns the tree envelope', async () => {
    post.mockResolvedValue({ data: { data: { tree: [], truncated: false } } });
    const res = await crawlUrl('ws1', 'https://ex.com');
    expect(post).toHaveBeenCalledWith('/workspaces/ws1/documents/crawl', { url: 'https://ex.com' });
    expect(res.truncated).toBe(false);
  });
  it('addLinks posts the urls and returns created docs', async () => {
    post.mockResolvedValue({ data: { data: [{ id: 'd1', type: 'url' }] } });
    const res = await addLinks('ws1', ['https://ex.com/a']);
    expect(post).toHaveBeenCalledWith('/workspaces/ws1/documents/links', { urls: ['https://ex.com/a'] });
    expect(res).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run to confirm failure**

Run: `cd front && npx vitest run src/modules/workspace/api.crawl.test.ts` → FAIL (not exported).

- [ ] **Step 5: Implement the api functions**

In `api.ts` (import `PageNode`/`CrawlResponse`/`WorkspaceDocument` from `./types` as needed):
```ts
export async function crawlUrl(workspaceId: string, url: string): Promise<CrawlResponse> {
  const response = await apiClient.post<ApiResponse<CrawlResponse>>(
    API_ENDPOINTS.workspaceDocuments.crawl(workspaceId),
    { url },
  );
  return response.data.data;
}

export async function addLinks(workspaceId: string, urls: string[]): Promise<WorkspaceDocument[]> {
  const response = await apiClient.post<ApiResponse<WorkspaceDocument[]>>(
    API_ENDPOINTS.workspaceDocuments.links(workspaceId),
    { urls },
  );
  return response.data.data;
}
```

- [ ] **Step 6: Add the store action**

In `store.ts`: add to the actions interface `addPageLinks: (workspaceId: string, urls: string[]) => Promise<void>;` and implement near `addPageLink`:
```ts
      addPageLinks: async (workspaceId, urls) => {
        await workspaceApi.addLinks(workspaceId, urls);
        await get().refreshPageData();
      },
```

- [ ] **Step 7: Run test + tsc**

Run: `cd front && npx vitest run src/modules/workspace/api.crawl.test.ts` → PASS. Then `cd front && npx tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add front/src/modules/workspace/types.ts front/src/lib/api/config.ts front/src/modules/workspace/api.ts front/src/modules/workspace/store.ts front/src/modules/workspace/api.crawl.test.ts
git commit -m "feat(workspace-ui): crawl/addLinks api, types, and addPageLinks store action"
```

---

### Task 7: `PageTree` component

**Files:**
- Create: `front/src/modules/workspace/components/PageTree.tsx`
- Create: `front/src/modules/workspace/components/PageTree.test.tsx`

**Interfaces:**
- Consumes: `PageNode` (T6).
- Produces: `PageTree({ nodes, selected, onToggle, onFocus })` where `selected: Set<string>`, `onToggle(url: string): void`, `onFocus(url: string): void`. Renders a recursive checkbox tree; `alreadyIndexed` rows are disabled with a "Déjà indexé" badge.

- [ ] **Step 1: Write the component test**

Create `PageTree.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageTree } from './PageTree';
import type { PageNode } from '../types';

const nodes: PageNode[] = [
  { url: 'https://ex.com/', path: '/', alreadyIndexed: false, children: [
    { url: 'https://ex.com/a', path: '/a', alreadyIndexed: false, children: [] },
    { url: 'https://ex.com/b', path: '/b', alreadyIndexed: true, children: [] },
  ] },
];

describe('PageTree', () => {
  it('toggles a selectable page and disables already-indexed rows', () => {
    const onToggle = vi.fn();
    render(<PageTree nodes={nodes} selected={new Set(['https://ex.com/'])} onToggle={onToggle} onFocus={() => {}} />);
    // '/a' is selectable
    fireEvent.click(screen.getByLabelText('/a'));
    expect(onToggle).toHaveBeenCalledWith('https://ex.com/a');
    // '/b' is already indexed -> its checkbox is disabled
    expect((screen.getByLabelText('/b') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/déjà indexé/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd front && npx vitest run src/modules/workspace/components/PageTree.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement `PageTree`**

Create `PageTree.tsx`:
```tsx
import type { PageNode } from '../types';

function Row({ node, depth, selected, onToggle, onFocus }: {
  node: PageNode; depth: number; selected: Set<string>;
  onToggle: (url: string) => void; onFocus: (url: string) => void;
}) {
  const label = node.path === '/' ? (node.title ?? node.url) : node.path;
  return (
    <div>
      <div
        className='flex items-center gap-2 rounded px-1 py-1 hover:bg-accent/50'
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        <input
          type='checkbox'
          aria-label={label}
          checked={selected.has(node.url)}
          disabled={node.alreadyIndexed}
          onChange={() => onToggle(node.url)}
        />
        <button
          type='button'
          className='min-w-0 flex-1 truncate text-left text-sm'
          onClick={() => onFocus(node.url)}
          title={node.url}
        >
          {node.title ? `${node.title} — ${label}` : label}
        </button>
        {node.alreadyIndexed && (
          <span className='shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'>
            Déjà indexé
          </span>
        )}
      </div>
      {node.children.map((c) => (
        <Row key={c.url} node={c} depth={depth + 1} selected={selected} onToggle={onToggle} onFocus={onFocus} />
      ))}
    </div>
  );
}

export function PageTree({ nodes, selected, onToggle, onFocus }: {
  nodes: PageNode[]; selected: Set<string>;
  onToggle: (url: string) => void; onFocus: (url: string) => void;
}) {
  return (
    <div className='max-h-[50vh] overflow-y-auto'>
      {nodes.map((n) => (
        <Row key={n.url} node={n} depth={0} selected={selected} onToggle={onToggle} onFocus={onFocus} />
      ))}
    </div>
  );
}

/** Collect every non-alreadyIndexed url in the tree (for select-all). */
export function collectSelectableUrls(nodes: PageNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: PageNode[]) => ns.forEach((n) => {
    if (!n.alreadyIndexed) out.push(n.url);
    walk(n.children);
  });
  walk(nodes);
  return out;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd front && npx vitest run src/modules/workspace/components/PageTree.test.tsx` → PASS. Then `cd front && npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/workspace/components/PageTree.tsx front/src/modules/workspace/components/PageTree.test.tsx
git commit -m "feat(workspace-ui): recursive PageTree checkbox component"
```

---

### Task 8: Two-phase `AddLinkDialog` (input → tree + preview)

**Files:**
- Modify: `front/src/modules/workspace/components/AddLinkDialog.tsx`
- Modify: `front/src/modules/workspace/components/AddLinkDialog.test.tsx`

**Interfaces:**
- Consumes: `crawlUrl` (T6), `addPageLinks` store action (T6), `PageTree` + `collectSelectableUrls` (T7), `PageNode`/`CrawlResponse` (T6).

- [ ] **Step 1: Update the dialog test for the two-phase flow**

Replace `AddLinkDialog.test.tsx` mocks/tests so `../api` exposes `crawlUrl` and the store exposes `addPageLinks`. Keep the format-validation test; replace the single-add tests with the crawl flow. Full file:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const crawlUrl = vi.fn();
const addPageLinks = vi.fn();

vi.mock('../api', () => ({ crawlUrl: (...a: unknown[]) => crawlUrl(...a) }));
vi.mock('../store', () => ({
  useWorkspaceStore: (sel: (s: unknown) => unknown) => sel({ addPageLinks }),
}));

import { AddLinkDialog } from './AddLinkDialog';

describe('AddLinkDialog', () => {
  beforeEach(() => { crawlUrl.mockReset(); addPageLinks.mockReset(); });

  it('blocks crawl on invalid URL format', async () => {
    render(<AddLinkDialog open onOpenChange={() => {}} workspaceId="ws1" />);
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: /lien/i }), { target: { value: 'not a url' } });
    fireEvent.click(screen.getByRole('button', { name: /cartographier/i }));
    expect(crawlUrl).not.toHaveBeenCalled();
    expect(await screen.findByText(/URL valide/i)).toBeInTheDocument();
  });

  it('shows an error when the site is unreachable', async () => {
    crawlUrl.mockResolvedValue({ tree: [], truncated: false, unreachable: true });
    render(<AddLinkDialog open onOpenChange={() => {}} workspaceId="ws1" />);
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: /lien/i }), { target: { value: 'https://ex.com' } });
    fireEvent.click(screen.getByRole('button', { name: /cartographier/i }));
    await waitFor(() => expect(crawlUrl).toHaveBeenCalledWith('ws1', 'https://ex.com'));
    expect(await screen.findByText(/injoignable/i)).toBeInTheDocument();
  });

  it('crawls, shows the tree, and adds selected pages', async () => {
    crawlUrl.mockResolvedValue({ truncated: false, tree: [
      { url: 'https://ex.com/', path: '/', alreadyIndexed: false, children: [
        { url: 'https://ex.com/a', path: '/a', alreadyIndexed: false, children: [] },
      ] },
    ] });
    addPageLinks.mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(<AddLinkDialog open onOpenChange={onOpenChange} workspaceId="ws1" />);
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: /lien/i }), { target: { value: 'https://ex.com' } });
    fireEvent.click(screen.getByRole('button', { name: /cartographier/i }));
    // Tree appears; root '/' is pre-checked. Add the child too.
    await screen.findByLabelText('/a');
    fireEvent.click(screen.getByLabelText('/a'));
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    await waitFor(() => expect(addPageLinks).toHaveBeenCalledWith(
      'ws1', expect.arrayContaining(['https://ex.com/', 'https://ex.com/a'])));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx` → FAIL (references crawl phase not yet implemented).

- [ ] **Step 3: Implement the two-phase dialog**

Rewrite `AddLinkDialog.tsx`. Phase `'input'` collects the URL and crawls; phase `'tree'` shows `PageTree` + a preview pane and adds selected. Full file:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { crawlUrl } from '../api';
import { useWorkspaceStore } from '../store';
import type { PageNode } from '../types';
import { PageTree, collectSelectableUrls } from './PageTree';

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function collectPreChecked(nodes: PageNode[]): Set<string> {
  // Pre-check the root(s) only, skipping already-indexed.
  const s = new Set<string>();
  nodes.forEach((n) => { if (!n.alreadyIndexed) s.add(n.url); });
  return s;
}

export function AddLinkDialog({
  open, onOpenChange, workspaceId, initialUrl = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  initialUrl?: string;
}) {
  const addPageLinks = useWorkspaceStore((s) => s.addPageLinks);
  const [phase, setPhase] = useState<'input' | 'tree'>('input');
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tree, setTree] = useState<PageNode[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusUrl, setFocusUrl] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPhase('input'); setUrl(initialUrl); setError(null); setBusy(false);
      setTree([]); setTruncated(false); setSelected(new Set()); setFocusUrl(null);
    }
  }, [open, initialUrl]);

  const selectableCount = useMemo(() => collectSelectableUrls(tree).length, [tree]);

  const handleCrawl = async () => {
    if (busy) return;
    setError(null);
    if (!isValidUrl(url)) {
      setError('Veuillez saisir une URL valide (http:// ou https://).');
      return;
    }
    const clean = url.trim();
    setBusy(true);
    try {
      const res = await crawlUrl(workspaceId, clean);
      if (res.unreachable) {
        setError('Ce site est injoignable. Vérifiez le lien et réessayez.');
        return;
      }
      setTree(res.tree);
      setTruncated(res.truncated);
      setSelected(collectPreChecked(res.tree));
      setFocusUrl(res.tree[0]?.url ?? clean);
      setPhase('tree');
    } catch {
      setError('Une erreur est survenue lors de la cartographie. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (u: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(u) ? n.delete(u) : n.add(u); return n; });
  const selectAll = () => setSelected(new Set(collectSelectableUrls(tree)));
  const selectNone = () => setSelected(new Set());

  const handleAdd = async () => {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      await addPageLinks(workspaceId, [...selected]);
      toast.success(`${selected.size} page(s) ajoutée(s) · conversion en cours`);
      onOpenChange(false);
    } catch {
      setError('Une erreur est survenue lors de l\'ajout. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className={phase === 'tree' ? 'max-w-4xl' : undefined}>
        <DialogHeader>
          <DialogTitle>Ajouter un lien</DialogTitle>
          <DialogDescription>
            {phase === 'input'
              ? "Indexez le contenu d'un site web. Cartographiez le site pour choisir les pages à indexer."
              : 'Sélectionnez les pages à indexer. Chaque page sera convertie en PDF puis indexée.'}
          </DialogDescription>
        </DialogHeader>

        {phase === 'input' ? (
          <div className='space-y-2'>
            <Label htmlFor='workspace-link-url'>Lien du site web</Label>
            <Input
              id='workspace-link-url'
              placeholder='https://exemple.com'
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCrawl(); }}
              autoFocus
              disabled={busy}
            />
            {error && <p className='text-sm text-destructive'>{error}</p>}
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
            <div className='min-w-0'>
              <div className='mb-2 flex items-center gap-2 text-xs'>
                <button type='button' className='underline' onClick={selectAll}>Tout sélectionner</button>
                <span className='text-muted-foreground'>·</span>
                <button type='button' className='underline' onClick={selectNone}>Aucun</button>
                {truncated && <span className='ml-auto text-muted-foreground'>Résultats limités</span>}
              </div>
              <PageTree nodes={tree} selected={selected} onToggle={toggle} onFocus={setFocusUrl} />
            </div>
            <div className='min-w-0'>
              {focusUrl ? (
                <div className='flex h-full flex-col'>
                  <div className='mb-1 flex items-center gap-2 text-xs text-muted-foreground'>
                    <span className='truncate' title={focusUrl}>{focusUrl}</span>
                    <a href={focusUrl} target='_blank' rel='noreferrer'
                       className='ml-auto inline-flex items-center gap-1 underline'>
                      Ouvrir <ExternalLink className='h-3 w-3' />
                    </a>
                  </div>
                  <iframe
                    title='Aperçu'
                    src={focusUrl}
                    sandbox='allow-scripts allow-same-origin'
                    className='h-[45vh] w-full rounded border'
                  />
                  <p className='mt-1 text-[11px] text-muted-foreground'>
                    L'aperçu peut être indisponible pour certains sites.
                  </p>
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>Sélectionnez une page pour l'aperçu.</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {phase === 'input' ? (
            <>
              <Button variant='outline' onClick={() => onOpenChange(false)} disabled={busy}>Annuler</Button>
              <Button onClick={handleCrawl} disabled={busy} className='gap-1.5'>
                {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                Cartographier
              </Button>
            </>
          ) : (
            <>
              <Button variant='outline' onClick={() => setPhase('input')} disabled={busy}>Retour</Button>
              <Button onClick={handleAdd} disabled={busy || selected.size === 0} className='gap-1.5'>
                {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                Ajouter ({selected.size})
              </Button>
            </>
          )}
        </DialogFooter>
        {phase === 'tree' && error && <p className='text-sm text-destructive'>{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
```

Note: `selectableCount` is computed for potential display; if unused after implementation, drop it to avoid a lint warning.

- [ ] **Step 4: Run the dialog test + tsc**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx` → PASS (3 tests). Then `cd front && npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/workspace/components/AddLinkDialog.tsx front/src/modules/workspace/components/AddLinkDialog.test.tsx
git commit -m "feat(workspace-ui): two-phase AddLinkDialog with crawl tree + preview"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Full backend suite** — `cd back && npm test` → all pass.
- [ ] **Step 2: Backend typecheck** — `cd back && npx tsc --noEmit -p tsconfig.json` → clean.
- [ ] **Step 3: Frontend typecheck** — `cd front && npx tsc --noEmit` → clean.
- [ ] **Step 4: Frontend feature tests** — `cd front && npx vitest run src/modules/workspace` → the feature tests (`api.crawl`, `PageTree`, `AddLinkDialog`, plus prior link tests) pass; confirm no NEW failures beyond the known pre-existing set (the same failing files present on the base commit — verify by comparing counts, do not assume).
- [ ] **Step 5: Manual smoke (documented; needs running services + real Gotenberg + a crawlable site)**
  1. Add a link to a site with a sitemap → tree shows multiple pages; root pre-checked.
  2. Select 2–3 pages → Ajouter → each appears as a converting link, then completed + indexed.
  3. Re-open the dialog for the same site → previously indexed pages show "Déjà indexé" and are disabled.
  4. Focus a page → preview loads in the iframe (or shows the open-in-tab fallback for framing-blocked sites).
  5. A site with no sitemap → crawl fallback still returns the reachable same-domain pages.

## Self-Review Notes

- **Spec coverage:** SSRF extraction (T1); crawler sitemap-first + fallback + caps + SSRF on every URL (T2); tree + alreadyIndexed (T3); bulk throttled conversion + single wrapper (T4); DTOs/endpoints/wiring (T5); FE types/api/store (T6); PageTree (T7); two-phase dialog with preview + fallback (T8); verification (T9).
- **No new dependencies:** sitemap/robots/HTML parsed with regex/string ops; inline `mapWithConcurrency`.
- **Reused invariants:** `type='url'`, PROCESSING, unique `link-pending:<id>.pdf` path, `convertAndStore`, `assertUrlIsSafe`, classifier `status` surfacing, live-status poll — all unchanged.
- **Type consistency:** `PageNode`/`CrawlResponse`/`DiscoveredPage`/`CrawlResult` names match across backend and frontend; `addLinks`/`addPageLinks`/`crawlUrl`/`crawlSite`/`buildPageTree`/`collectSelectableUrls` are each defined in the task that first references them.
- **Deferred-to-plan items from the spec now decided:** dependency-free parsing (no cheerio); `AddLinkDialog` kept as one two-phase file (not split); an SSRF-rejected URL during a fetch is simply skipped (crawler `safeGet` returns null); a bulk URL that fails conversion becomes a FAILED doc (existing `convertAndStore` behavior).
