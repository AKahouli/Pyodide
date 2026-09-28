import { UrlToPdfClientService } from './url-to-pdf-client.service';

function makeService() {
  const config = { get: (k: string, d?: unknown) => (k === 'indexing.urlToPdfApiUrl' ? 'http://pdf.test' : k === 'indexing.urlToPdfApiKey' ? 'secret' : d) };
  const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return new UrlToPdfClientService(config as any, logger as any);
}

describe('UrlToPdfClientService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('posts convert-url-pdf as url-encoded form data with hardcoded flags and returns a Buffer', async () => {
    fetchMock.mockResolvedValue(new Response(Buffer.from('%PDF-1.4 fake'), { status: 200 }));
    const svc = makeService();
    const out = await svc.convert('https://example.com', 'example-com.pdf');
    expect(Buffer.isBuffer(out)).toBe(true);

    // The Gotenberg-wrapper API consumes application/x-www-form-urlencoded, not JSON.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pdf.test/convert-url-pdf');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.headers['x-api-key']).toBe('secret');
    const body: URLSearchParams = init.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get('url')).toBe('https://example.com');
    expect(body.get('filename')).toBe('example-com.pdf');
    expect(body.get('print_background')).toBe('true');
    expect(body.get('prefer_css_page_size')).toBe('true');
  });

  it('throws a descriptive error on failure', async () => {
    fetchMock.mockResolvedValue(new Response('bad', { status: 502 }));
    const svc = makeService();
    await expect(svc.convert('https://x.com', 'x.pdf')).rejects.toThrow(/URL-to-PDF API error: 502/);
  });
});
