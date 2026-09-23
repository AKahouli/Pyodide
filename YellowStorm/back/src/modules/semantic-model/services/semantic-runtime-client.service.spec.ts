import axios from 'axios';
import { SemanticRuntimeClientService } from './semantic-runtime-client.service';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);

const config = (overrides: Record<string, unknown> = {}) => ({
  runtimeEnabled: true,
  runtimeWritesEnabled: true,
  runtimeUrl: 'http://runtime:8000',
  runtimeServiceKey: 'secret',
  runtimeRequestTimeoutMs: 5000,
  ...overrides,
});

const runCommand = {
  actorUserId: 'u1',
  modelId: 'm1',
  workspaceId: 'w1',
  payload: { purpose: 'build' },
};

describe('SemanticRuntimeClientService (P2.11)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts population runs with service key, idempotency key and timeout', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { jobId: 'j1', reused: false } });
    const client = new SemanticRuntimeClientService(config() as any);
    const result = await client.requestPopulationRun(runCommand, 'idem-1');
    expect(result).toEqual({ jobId: 'j1', reused: false });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://runtime:8000/v1/semantic-model-population/runs',
      runCommand,
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Semantic-Service-Key': 'secret',
          'Idempotency-Key': 'idem-1',
        }),
        timeout: 5000,
      }),
    );
  });

  it('refuses writes when the runtime is disabled or unconfigured', async () => {
    const disabled = new SemanticRuntimeClientService(config({ runtimeWritesEnabled: false }) as any);
    await expect(disabled.requestPopulationRun(runCommand, 'k')).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
    });
    const unconfigured = new SemanticRuntimeClientService(config({ runtimeUrl: '' }) as any);
    await expect(unconfigured.recordCorrection({} as any)).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
    });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('allows bound reads when runtime writes are disabled', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { dataRevisionId: 'dr_1', nodes: [], edges: [] } });
    const client = new SemanticRuntimeClientService(config({ runtimeWritesEnabled: false }) as any);
    await expect(client.getBoundGraph('m1', 'u1')).resolves.toMatchObject({ dataRevisionId: 'dr_1' });
  });

  it('maps runtime 409 to conflict and 404 to not-found', async () => {
    const client = new SemanticRuntimeClientService(config() as any);
    (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: 'stale' } } });
    await expect(
      client.activateRevision('dr_1', { actorUserId: 'u', modelId: 'm', modelVersionId: 'v', expectedCorrectionSequence: 0 }),
    ).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT });

    mockedAxios.post.mockRejectedValueOnce({ response: { status: 404, data: {} } });
    await expect(client.projectRevision('missing')).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_NOT_FOUND,
    });
  });

  it('maps transport failures to unavailable without retrying', async () => {
    const client = new SemanticRuntimeClientService(config() as any);
    (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);
    mockedAxios.post.mockRejectedValueOnce(new Error('timeout'));
    await expect(client.resolveReview('r1', { actorUserId: 'u', modelId: 'm', resolution: {} })).rejects.toMatchObject(
      { code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE },
    );
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});
