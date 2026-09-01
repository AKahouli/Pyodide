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
    enabled: true,
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
    nativeSearchAuthToken: 'test-token',
    nativeSearchLogQuery: false,
    evidenceSearchTimeoutMs: 180000,
    evidenceSearchConcurrency: 4,
    ontologyTimeoutMs: 0,
    mappingTimeoutMs: 0,
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
        timeout: 180000,
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
