import axios from 'axios';
import { SemanticSearchGraphClient } from './semantic-search-graph-client.service';

jest.mock('axios');

describe('SemanticSearchGraphClient', () => {
  const ageGraph = { graphNameForModel: jest.fn(() => 'sem_model_id') };
  const mockedAxios = jest.mocked(axios);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ data: {} });
  });

  it('indexes the model AGE schema with bearer authentication', async () => {
    const service = new SemanticSearchGraphClient(
      { semanticSearchUrl: 'http://127.0.0.1:8100/', semanticSearchToken: 'secret', semanticSearchTimeoutMs: 300_000 } as never,
      ageGraph as never,
    );

    await service.index('model-id');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://127.0.0.1:8100/v1/graphs/index',
      { schema_name: 'sem_model_id' },
      {
        headers: { Authorization: 'Bearer secret' },
        timeout: 300_000,
      },
    );
  });

  it('rejects indexing when the bearer token is not configured', async () => {
    const service = new SemanticSearchGraphClient(
      { semanticSearchUrl: 'http://127.0.0.1:8100', semanticSearchToken: '', semanticSearchTimeoutMs: 300_000 } as never,
      ageGraph as never,
    );

    await expect(service.index('model-id')).rejects.toThrow(
      'SEMANTIC_SEARCH_TOKEN is required to index the semantic graph',
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
