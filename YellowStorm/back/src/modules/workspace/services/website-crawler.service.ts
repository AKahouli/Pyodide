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
    const { sitemaps: robotsSitemaps, disallow } = await this.fetchRobots(seed.origin, deadline);
    let urls = await this.discoverViaSitemap(seed.origin, host, robotsSitemaps, deadline);

    let pages: DiscoveredPage[];
    let fallbackTruncated = false;
    if (urls.length > 0) {
      pages = urls.map((url) => ({ url }));
    } else {
      // 2. Crawl fallback (BFS), collecting titles.
      const result = await this.crawlFallback(seed, host, disallow, deadline);
      pages = result.pages;
      fallbackTruncated = result.truncated;
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

    const truncated = fallbackTruncated || deduped.length > this.maxPages;
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

  /**
   * Fetches a URL, manually following redirects (max 5 hops) so that each
   * hop is re-validated with assertUrlIsSafe before being requested. axios's
   * built-in `maxRedirects` would follow a redirect chain WITHOUT
   * re-checking the SSRF guard, letting an attacker-controlled seed URL
   * 302/301 to an internal address (e.g. cloud metadata) and bypass the
   * guard entirely — so auto-redirects are disabled here and each hop is
   * resolved + guarded one at a time instead.
   */
  private async safeGet(url: string, deadline: number): Promise<string | null> {
    const MAX_HOPS = 5;
    let currentUrl = url;
    try {
      for (let hop = 0; hop <= MAX_HOPS; hop++) {
        if (Date.now() > deadline) return null;
        await assertUrlIsSafe(currentUrl);
        const res = await axios.get(currentUrl, {
          timeout: Math.min(FETCH_TIMEOUT_MS, Math.max(0, deadline - Date.now())),
          maxContentLength: MAX_BYTES,
          maxRedirects: 0,
          responseType: 'text',
          validateStatus: (s) => s >= 200 && s < 400,
          transformResponse: (d) => d,
        });

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers?.location as string | undefined;
          (res.data as { destroy?: () => void })?.destroy?.();
          if (!location) return null;
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }

        return typeof res.data === 'string' ? res.data : String(res.data);
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Fetches robots.txt once and returns both the Sitemap: entries and the Disallow rules (User-agent: * scoped). */
  private async fetchRobots(origin: string, deadline: number): Promise<{ sitemaps: string[]; disallow: string[] }> {
    const sitemaps: string[] = [];
    const disallow: string[] = [];
    const body = await this.safeGet(`${origin}/robots.txt`, deadline);
    if (!body) return { sitemaps, disallow };
    let appliesToAll = false;
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      const lower = line.toLowerCase();
      if (lower.startsWith('user-agent:')) {
        appliesToAll = line.split(':')[1].trim() === '*';
      } else if (appliesToAll && lower.startsWith('disallow:')) {
        const path = line.slice(line.indexOf(':') + 1).trim();
        if (path) disallow.push(path);
      } else if (lower.startsWith('sitemap:')) {
        sitemaps.push(line.slice(line.indexOf(':') + 1).trim());
      }
    }
    return { sitemaps, disallow };
  }

  private async discoverViaSitemap(
    origin: string, host: string, robotsSitemaps: string[], deadline: number,
  ): Promise<string[]> {
    // robots Sitemap: lines (same-host only) + default /sitemap.xml
    const sitemapUrls = new Set<string>();
    for (const sm of robotsSitemaps) {
      if (this.sameHost(sm, host)) sitemapUrls.add(sm);
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
        if (isIndex) {
          if (this.sameHost(loc, host)) nested.push(loc);
        } else if (this.sameHost(loc, host)) {
          found.add(this.normalize(loc));
        }
      }
    }
    // Follow nested sitemaps one level (same-host only).
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
  ): Promise<{ pages: DiscoveredPage[]; truncated: boolean }> {
    const visited = new Set<string>([this.normalize(seed.toString())]);
    const results: DiscoveredPage[] = [];
    let frontier: string[] = [seed.toString()];
    let truncated = false;

    for (let depth = 0; depth <= this.maxDepth; depth++) {
      if (frontier.length === 0) break;
      if (Date.now() > deadline) {
        // Time budget stopped the crawl with an unfetched frontier still queued.
        truncated = true;
        break;
      }
      if (results.length >= this.maxPages) {
        truncated = true;
        break;
      }
      const next: string[] = [];
      await mapWithConcurrency(frontier, this.concurrency, async (pageUrl) => {
        if (Date.now() > deadline) {
          // Candidate skipped because the time budget ran out mid-depth.
          truncated = true;
          return;
        }
        if (results.length >= this.maxPages) {
          truncated = true;
          return;
        }
        const html = await this.safeGet(pageUrl, deadline);
        if (html === null) return;
        results.push({ url: this.normalize(pageUrl), title: this.extractTitle(html) });
        if (depth === this.maxDepth) return;
        for (const link of this.extractLinks(html, pageUrl)) {
          const n = this.normalize(link);
          if (visited.has(n) || !this.sameHost(link, host) || this.isDisallowed(link, disallow)) continue;
          if (visited.size >= this.maxPages) {
            truncated = true;
            break;
          }
          visited.add(n);
          next.push(link);
        }
      });
      frontier = next;
    }
    return { pages: results, truncated };
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
