import { ConfigType } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import { ServiceUnavailableException } from '@modules/exceptions';
import { Logger } from '@nestjs/common';
import { SemanticModelNativeSearchClient } from './semantic-model-native-search-client.service';

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
    ontologyTimeoutMs: 0,
    documentExtractionAgentId: '',
    documentExtractionTimeoutMs: 180000,
    ...overrides,
    // Partial spread widens every key to `T | undefined`; the base literal above supplies them all.
  } as ConfigType<typeof semanticModelConfig>;
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('SemanticModelNativeSearchClient', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('posts the exact search payload with bearer authentication only', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: [{ content: 'Evidence' }] }));
    const client = new SemanticModelNativeSearchClient(config());
    const request = { query: 'Employee: name', workspace_id: 'workspace-1', file_name: 'employee.pdf' };

    await expect(client.search(request)).resolves.toEqual([{ content: 'Evidence' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8045/search_native');
    expect(JSON.parse(init.body)).toEqual(request);
    expect(init.headers).toEqual({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
    expect(init.headers).not.toHaveProperty('X-User-Id');
  });

  it('accepts a raw section array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ content: 'Evidence' }]));
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .resolves.toEqual([{ content: 'Evidence' }]);
  });

  it('posts and correlates a native-search batch by id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      results: [
        { id: '1', error: { message: 'not found' } },
        { id: '0', result: [{ content: 'Evidence A' }] },
      ],
    }));
    const client = new SemanticModelNativeSearchClient(config());
    const requests = [
      { query: 'q1', workspace_id: 'w', file_name: 'a.pdf' },
      { query: 'q2', workspace_id: 'w', file_name: 'b.pdf' },
    ];

    await expect(client.searchBatch(requests)).resolves.toEqual([
      { sections: [{ content: 'Evidence A' }], error: null },
      { sections: [], error: 'not found' },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8045/search_native/batch');
    expect(JSON.parse(init.body)).toEqual({
      requests: [
        { id: '0', ...requests[0] },
        { id: '1', ...requests[1] },
      ],
    });
    expect(init.headers).toEqual({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
  });

  it('rejects batches larger than ten without sending them', async () => {
    const client = new SemanticModelNativeSearchClient(config());
    const requests = Array.from({ length: 11 }, (_, index) => ({
      query: `q${index}`,
      workspace_id: 'w',
      file_name: 'f.pdf',
    }));

    await expect(client.searchBatch(requests)).rejects.toThrow('10-request limit');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a batch response with missing or duplicate ids', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ id: '0', result: [] }, { id: '0', result: [] }] }));
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.searchBatch([
      { query: 'q1', workspace_id: 'w', file_name: 'a.pdf' },
      { query: 'q2', workspace_id: 'w', file_name: 'b.pdf' },
    ])).rejects.toThrow('invalid batch response');
  });

  it('retries a transient batch failure once', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: '0', result: [] }] }));
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.searchBatch([
      { query: 'q', workspace_id: 'w', file_name: 'f.pdf' },
    ])).resolves.toEqual([{ sections: [], error: null }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('supports a single bounded batch attempt for interactive extraction', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.searchBatch([
      { query: 'q', workspace_id: 'w', file_name: 'f.pdf' },
    ], 30_000, 1)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
  });

  it('rejects malformed responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: 'invalid' }));
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('requires the bearer token', async () => {
    const client = new SemanticModelNativeSearchClient(config({ nativeSearchAuthToken: '' }));

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries one transient failure', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse([]));
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry authentication failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces redacted FastAPI validation details', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      detail: [{
        loc: ['body', 'workspace_id'],
        msg: 'Field required',
        type: 'missing',
        input: { sensitive: 'not logged' },
      }],
    }), { status: 422 }));
    const client = new SemanticModelNativeSearchClient(config());

    await expect(client.search({ query: 'q', workspace_id: 'w', file_name: 'f.pdf' }))
      .rejects.toThrow('HTTP 422: body.workspace_id [missing]');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('supports opt-in bounded query diagnostics', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
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
