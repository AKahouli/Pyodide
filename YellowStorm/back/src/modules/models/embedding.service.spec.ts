import { EmbeddingService } from './embedding.service';

function loggerStub() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
}
const config = {
  get: jest.fn((key: string, fallback?: unknown) => {
    if (key === 'litellm.embeddingsEndpoint') return '/v1/embeddings';
    if (key === 'litellm.embeddingModel') return 'text-embedding-3-large';
    if (key === 'litellm.embeddingDimension') return 3072;
    return fallback;
  }),
} as any;

describe('EmbeddingService', () => {
  it('returns the embedding vector from the LiteLLM response', async () => {
    const post = jest.fn().mockResolvedValue({ data: { data: [{ embedding: [0.1, 0.2, 0.3] }] } });
    const connection = { getHttpClient: () => ({ post }) } as any;
    const svc = new EmbeddingService(connection, config, loggerStub());

    await expect(svc.embed('Alice. Support agent')).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(post).toHaveBeenCalledWith('/v1/embeddings', {
      model: 'text-embedding-3-large', input: 'Alice. Support agent', dimensions: 3072,
    });
  });

  it('returns null when the LiteLLM client is not configured', async () => {
    const connection = { getHttpClient: () => null } as any;
    const svc = new EmbeddingService(connection, config, loggerStub());
    await expect(svc.embed('x')).resolves.toBeNull();
  });

  it('returns null (never throws) when the request fails', async () => {
    const connection = { getHttpClient: () => ({ post: jest.fn().mockRejectedValue(new Error('down')) }) } as any;
    const svc = new EmbeddingService(connection, config, loggerStub());
    await expect(svc.embed('x')).resolves.toBeNull();
  });
});
