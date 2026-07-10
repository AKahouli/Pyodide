import { UrlToPdfClientService } from './url-to-pdf-client.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeService() {
  const config = { get: (k: string, d?: unknown) => (k === 'indexing.urlToPdfApiUrl' ? 'http://pdf.test' : k === 'indexing.urlToPdfApiKey' ? 'secret' : d) };
  const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return new UrlToPdfClientService(config as any, logger as any);
}

describe('UrlToPdfClientService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts convert-url-pdf as url-encoded form data with hardcoded flags and returns a Buffer', async () => {
    const post = jest.fn().mockResolvedValue({ data: Buffer.from('%PDF-1.4 fake') });
    mockedAxios.create.mockReturnValue({ post, interceptors: { request: { use: jest.fn() } } } as any);
    const svc = makeService();
    const out = await svc.convert('https://example.com', 'example-com.pdf');
    expect(Buffer.isBuffer(out)).toBe(true);

    // The Gotenberg-wrapper API consumes application/x-www-form-urlencoded, not JSON.
    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      }),
    );
    const [path, body, config] = post.mock.calls[0];
    expect(path).toBe('/convert-url-pdf');
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get('url')).toBe('https://example.com');
    expect(body.get('filename')).toBe('example-com.pdf');
    expect(body.get('print_background')).toBe('true');
    expect(body.get('prefer_css_page_size')).toBe('true');
    expect(config).toEqual({ responseType: 'arraybuffer' });
  });

  it('throws a descriptive error on failure', async () => {
    const post = jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { isAxiosError: true, response: { status: 502, data: 'bad' } }));
    mockedAxios.create.mockReturnValue({ post, interceptors: { request: { use: jest.fn() } } } as any);
    mockedAxios.isAxiosError.mockReturnValue(true as any);
    const svc = makeService();
    await expect(svc.convert('https://x.com', 'x.pdf')).rejects.toThrow(/URL-to-PDF API error: 502/);
  });
});
