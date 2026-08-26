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
      'litellm.embeddingModel': 'qwen3-embedding',
      'litellm.embeddingDimension': 2560,
      'litellm.timeoutMs': 10000,
      'litellm.apiKey': 'k',
    };
    return key in m ? m[key] : fallback;
  }),
} as any;

describe('EmbeddingService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the embedding vector from the LiteLLM response', async () => {
    const embedding = Array.from({ length: 2560 }, (_, index) => index / 2560);
    mockedAxios.post.mockResolvedValue({ data: { data: [{ embedding }] } });
    const svc = new EmbeddingService(config, loggerStub());

    await expect(svc.embed('Alice. Support agent')).resolves.toEqual(embedding);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://litellm/v1/embeddings',
      { model: 'qwen3-embedding', input: 'Alice. Support agent' },
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

  it('returns null when LiteLLM returns the wrong number of dimensions', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: [{ embedding: [0.1, 0.2] }] } });
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
    mockedAxios.post.mockResolvedValue({ data: { data: [{ embedding }] } });
    const svc = new EmbeddingService(config, loggerStub());

    await expect(svc.embed('x')).resolves.toBeNull();
  });
});
