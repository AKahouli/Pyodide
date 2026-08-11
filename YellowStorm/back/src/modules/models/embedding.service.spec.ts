jest.mock('axios');
import axios from 'axios';
import { EmbeddingService } from './embedding.service';

const mockedAxios = axios as jest.Mocked<typeof axios>;

function loggerStub() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
}
const config = {
  get: jest.fn((key: string, fallback?: unknown) => {
    const m: Record<string, unknown> = {
      'litellm.apiUrl': 'http://litellm',
      'litellm.embeddingsEndpoint': '/v1/embeddings',
      'litellm.embeddingModel': 'text-embedding-3-large',
      'litellm.embeddingDimension': 3072,
      'litellm.timeoutMs': 10000,
      'litellm.apiKey': 'k',
    };
    return key in m ? m[key] : fallback;
  }),
} as any;

describe('EmbeddingService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the embedding vector from the LiteLLM response', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: [{ embedding: [0.1, 0.2, 0.3] }] } });
    const svc = new EmbeddingService(config, loggerStub());

    await expect(svc.embed('Alice. Support agent')).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://litellm/v1/embeddings',
      { model: 'text-embedding-3-large', input: 'Alice. Support agent', dimensions: 3072 },
      expect.objectContaining({ headers: { Authorization: 'Bearer k' } }),
    );
  });

  it('returns null when the LiteLLM API URL is not configured', async () => {
    const cfg = { get: jest.fn((k: string, fb?: unknown) => (k === 'litellm.apiUrl' ? '' : fb)) } as any;
    const svc = new EmbeddingService(cfg, loggerStub());
    await expect(svc.embed('x')).resolves.toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('returns null (never throws) when the request fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('down'));
    const svc = new EmbeddingService(config, loggerStub());
    await expect(svc.embed('x')).resolves.toBeNull();
  });
});
