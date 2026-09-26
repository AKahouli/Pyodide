import { SemanticSearchGraphClient } from './semantic-search-graph-client.service';

describe('SemanticSearchGraphClient', () => {
  const ageGraph = { graphNameForModel: jest.fn(() => 'sem_model_id') };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('indexes the model AGE schema with bearer authentication', async () => {
    const service = new SemanticSearchGraphClient(
      { semanticSearchUrl: 'http://127.0.0.1:8100/', semanticSearchToken: 'secret', semanticSearchTimeoutMs: 300_000 } as never,
      ageGraph as never,
    );

    await service.index('model-id');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8100/v1/graphs/index');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toEqual({ schema_name: 'sem_model_id' });
  });

  it('rejects indexing when the bearer token is not configured', async () => {
    const service = new SemanticSearchGraphClient(
      { semanticSearchUrl: 'http://127.0.0.1:8100', semanticSearchToken: '', semanticSearchTimeoutMs: 300_000 } as never,
      ageGraph as never,
    );

    await expect(service.index('model-id')).rejects.toThrow(
      'SEMANTIC_SEARCH_TOKEN is required to index the semantic graph',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
