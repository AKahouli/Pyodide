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
    expect(res.pages.length).toBe(3);
    const urls = res.pages.map((p) => p.url);
    expect(urls.some((u) => /\/p[1-5]$/.test(u))).toBe(true);
    expect(res.truncated).toBe(true);
  });

  it('rejects an unsafe seed (SSRF)', async () => {
    const dns = require('dns/promises');
    dns.lookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    await expect(makeService().crawl('http://internal.test/')).rejects.toThrow(/disallowed/i);
  });

  it('does not follow a redirect to an internal host (redirect SSRF guard)', async () => {
    const dns = require('dns/promises');
    dns.lookup.mockImplementation((hostname: string) => {
      if (hostname === '169.254.169.254') {
        return Promise.resolve([{ address: '169.254.169.254', family: 4 }]);
      }
      return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
    });

    // A fake "server": seed page links to /redirect-me, which 302s to a
    // cloud-metadata address whose response body carries a secret marker.
    const pageMap: Record<string, { status: number; data: string; headers: Record<string, string> }> = {
      'https://ex.com/robots.txt': { status: 404, data: '', headers: {} },
      'https://ex.com/sitemap.xml': { status: 404, data: '', headers: {} },
      'https://ex.com/': {
        status: 200,
        data: '<html><body><a href="https://ex.com/redirect-me">link</a></body></html>',
        headers: { 'content-type': 'text/html' },
      },
      'https://ex.com/redirect-me': {
        status: 302,
        data: '',
        headers: { location: 'http://169.254.169.254/secret' },
      },
      'http://169.254.169.254/secret': {
        status: 200,
        data: '<html><title>metadata-secret</title></html>',
        headers: { 'content-type': 'text/html' },
      },
    };

    // Mimics real axios: when maxRedirects > 0, transparently follows 3xx
    // hops server-side (as the un-guarded old implementation relied on);
    // when maxRedirects === 0 (the fixed implementation), returns the raw
    // 3xx response so the caller must re-validate and follow it manually.
    mockedAxios.get.mockImplementation(async (url: string, config?: { maxRedirects?: number }) => {
      const maxRedirects = config?.maxRedirects ?? 5;
      let currentUrl = url;
      let hops = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = pageMap[currentUrl] ?? { status: 404, data: '', headers: {} };
        if (res.status >= 300 && res.status < 400 && hops < maxRedirects) {
          currentUrl = new URL(res.headers.location, currentUrl).toString();
          hops++;
          continue;
        }
        return res;
      }
    });

    const res = await makeService().crawl('https://ex.com/');

    // The internal redirect target's content must never leak into the
    // crawl result, and the internal address itself must never appear.
    expect(res.pages.some((p) => p.title === 'metadata-secret')).toBe(false);
    expect(res.pages.some((p) => p.url.includes('169.254.169.254'))).toBe(false);
  });
});
