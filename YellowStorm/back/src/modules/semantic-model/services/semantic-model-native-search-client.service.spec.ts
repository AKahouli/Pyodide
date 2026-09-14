import { ConfigType } from '@nestjs/config';
import axios from 'axios';
import semanticModelConfig from '@config/semantic-model.config';
import { ServiceUnavailableException } from '@modules/exceptions';
import { Logger } from '@nestjs/common';
import { SemanticModelNativeSearchClient } from './semantic-model-native-search-client.service';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);

function config(
  overrides: Partial<ConfigType<typeof semanticModelConfig>> = {},
): ConfigType<typeof semanticModelConfig> {
  return {
    autoProvision: false,
    host: '',
    port: 5432,
    user: '',
    password: '',
    database: '',
    ssl: false,
    poolMax: 10,
    schema: 'semantic_model',
    ageGraph: 'semantic_model_graph',
    nativeSearchUrl: 'http://localhost:8045/search_native',
    nativeSearchBatchUrl: 'http://localhost:8045/search_native/batch',
    nativeSearchAuthToken: 'test-token',
    nativeSearchLogQuery: false,
    semanticSearchUrl: 'http://127.0.0.1:8100',
    semanticSearchToken: 'test-token',
    semanticSearchTimeoutMs: 300_000,
    evidenceSearchTimeoutMs: 180000,
    evidenceSearchConcurrency: 4,
    ontologyTimeoutMs: 0,
    mappingTimeoutMs: 0,
    documentExtractionAgentId: '',
    documentExtractionTimeoutMs: 180000,
    ...overrides,
  };
}

describe('SemanticModelNativeSearchClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown) => Boolean(error && typeof error === 'object' && 'response' in error),
    );
  });

  it('posts the exact search payload with bearer authentication only', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { result: [{ content: 'Evidence' }] } });
    const client = new SemanticModelNativeSearchClient(config());
    const request = { query: 'Employee: name', workspace_id: 'workspace-1', file_name: 'employee.pdf' };

    await expect(client.search(request)).resolves.toEqual([{ content: 'Evidence' }]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://localhost:8045/search_native',
      request,
      {
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        timeout: 0,
      },
    );
    expect(mockedAxios.post.mock.calls[0][2]?.headers).not.toHaveProperty('X-User-Id');
  });

  it('accepts a raw section array', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: [{ content: 'Evidence' }] });
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .resolves.toEqual([{ content: 'Evidence' }]);
  });

  it('posts and correlates a native-search batch by id', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        results: [
          { id: '1', error: { message: 'not found' } },
          { id: '0', result: [{ content: 'Evidence A' }] },
        ],
      },
    });
    const client = new SemanticModelNativeSearchClient(config());
    const requests = [
      { query: 'q1', workspace_id: 'w', file_name: 'a.pdf' },
      { query: 'q2', workspace_id: 'w', file_name: 'b.pdf' },
    ];

    await expect(client.searchBatch(requests)).resolves.toEqual([
      { sections: [{ content: 'Evidence A' }], error: null },
      { sections: [], error: 'not found' },
    ]);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://localhost:8045/search_native/batch',
      {
        requests: [
          { id: '0', ...requests[0] },
          { id: '1', ...requests[1] },
        ],
      },
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        timeout: 0,
      }),
    );
  });

  it('rejects batches larger than ten without sending them', async () => {
    const client = new SemanticModelNativeSearchClient(config());
    const requests = Array.from({ length: 11 }, (_, index) => ({
      query: `q${index}`,
      workspace_id: 'w',
      file_name: 'f.pdf',
    }));

    await expect(client.searchBatch(requests)).rejects.toThrow('10-request limit');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('rejects a batch response with missing or duplicate ids', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { results: [{ id: '0', result: [] }, { id: '0', result: [] }] },
    });
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.searchBatch([
      { query: 'q1', workspace_id: 'w', file_name: 'a.pdf' },
      { query: 'q2', workspace_id: 'w', file_name: 'b.pdf' },
    ])).rejects.toThrow('invalid batch response');
  });

  it('retries a transient batch failure once', async () => {
    mockedAxios.post
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ data: { results: [{ id: '0', result: [] }] } });
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.searchBatch([
      { query: 'q', workspace_id: 'w', file_name: 'f.pdf' },
    ])).resolves.toEqual([{ sections: [], error: null }]);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('supports a single bounded batch attempt for interactive extraction', async () => {
    mockedAxios.post.mockRejectedValue({ response: { status: 503 } });
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.searchBatch([
      { query: 'q', workspace_id: 'w', file_name: 'f.pdf' },
    ], 30_000, 1)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://localhost:8045/search_native/batch',
      expect.any(Object),
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it('rejects malformed responses', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { result: 'invalid' } });
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('requires the bearer token', async () => {
    const client = new SemanticModelNativeSearchClient(config({ nativeSearchAuthToken: '' }));

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('retries one transient failure', async () => {
    mockedAxios.post
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ data: [] });
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .resolves.toEqual([]);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('does not retry authentication failures', async () => {
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 401 } });
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('surfaces redacted FastAPI validation details', async () => {
    mockedAxios.post.mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          detail: [{
            loc: ['body', 'workspace_id'],
            msg: 'Field required',
            type: 'missing',
            input: { sensitive: 'not logged' },
          }],
        },
      },
    });
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .rejects.toThrow('HTTP 422: body.workspace_id [missing]');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('supports opt-in bounded query diagnostics', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: [] });
    const client = new SemanticModelNativeSearchClient(config({ nativeSearchLogQuery: true }));
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    await expect(client.search({
      query: `Employee:\n${'name '.repeat(150)}`,
      workspace_id: 'w',
      file_name: 'f.pdf',
    })).resolves.toEqual([]);
    expect(debug).toHaveBeenCalledWith(
      'Semantic native search request',
      expect.objectContaining({ query: expect.any(String) }),
    );
    const metadata = debug.mock.calls[0][1] as { query: string };
    expect(metadata.query).not.toContain('\n');
    expect(metadata.query.length).toBeLessThanOrEqual(500);
    debug.mockRestore();
  });
});
