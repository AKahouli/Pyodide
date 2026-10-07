import { EmbeddingService } from './embedding.service';

let fetchMock: jest.Mock;

function loggerStub() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
}
const config = {
  get: jest.fn((key: string, fallback?: unknown) => {
    const m: Record<string, unknown> = {
      'litellm.apiUrl': 'http://litellm',
      'litellm.embeddingsEndpoint': '/v1/embeddings',
      'litellm.embeddingModel': 'qwen3-embedding',
      'litellm.embeddingDimension': 2560,
      'litellm.timeoutMs': 10000,
      'litellm.apiKey': 'k',
    };
    return key in m ? m[key] : fallback;
  }),
} as any;

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('EmbeddingService', () => {
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('returns the embedding vector from the LiteLLM response', async () => {
    const embedding = Array.from({ length: 2560 }, (_, index) => index / 2560);
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ embedding }] }));
    const svc = new EmbeddingService(config, loggerStub());

    await expect(svc.embed('Alice. Support agent')).resolves.toEqual(embedding);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://litellm/v1/embeddings');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer k' });
    expect(init.body).toBe(JSON.stringify({ model: 'qwen3-embedding', input: 'Alice. Support agent' }));
  });

  it('returns null when the LiteLLM API URL is not configured', async () => {
    const cfg = { get: jest.fn((k: string, fb?: unknown) => (k === 'litellm.apiUrl' ? '' : fb)) } as any;
    const svc = new EmbeddingService(cfg, loggerStub());
    await expect(svc.embed('x')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null (never throws) when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    const svc = new EmbeddingService(config, loggerStub());
    await expect(svc.embed('x')).resolves.toBeNull();
  });

  it('returns null when LiteLLM returns the wrong number of dimensions', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ embedding: [0.1, 0.2] }] }));
    const logger = loggerStub();
    const svc = new EmbeddingService(config, logger);

    await expect(svc.embed('x')).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith('Embedding response has an invalid vector shape', {
      expectedDimensions: 2560,
      actualDimensions: 2,
    });
  });

  it('returns null when LiteLLM returns a non-finite vector value', async () => {
    const embedding = Array.from({ length: 2560 }, () => 0.1);
    embedding[42] = Number.NaN;
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ embedding }] }));
    const svc = new EmbeddingService(config, loggerStub());

    await expect(svc.embed('x')).resolves.toBeNull();
  });
});
