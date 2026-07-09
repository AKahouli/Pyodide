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
