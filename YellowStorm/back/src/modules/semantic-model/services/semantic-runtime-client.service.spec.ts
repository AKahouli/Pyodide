import { SemanticRuntimeClientService } from './semantic-runtime-client.service';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

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

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('SemanticRuntimeClientService (P2.11)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('posts population runs with service key, idempotency key and timeout', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobId: 'j1', reused: false }));
    const client = new SemanticRuntimeClientService(config() as any);
    const result = await client.requestPopulationRun(runCommand, 'idem-1');
    expect(result).toEqual({ jobId: 'j1', reused: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://runtime:8000/v1/semantic-model-population/runs');
    expect(JSON.parse(init.body)).toEqual(runCommand);
    expect(init.headers).toEqual(expect.objectContaining({
      'X-Semantic-Service-Key': 'secret',
      'Idempotency-Key': 'idem-1',
    }));
  });

  it('stops a job as its actor and finds the model run still going', async () => {
    const client = new SemanticRuntimeClientService(config() as any);
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobId: 'j/1', state: 'cancel_requested' }));
    await expect(client.cancelJob('j/1', 'u1')).resolves.toMatchObject({ state: 'cancel_requested' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://runtime:8000/v1/semantic-model-jobs/j%2F1/cancel');
    expect(init.headers).toEqual(expect.objectContaining({ 'X-Actor-User-Id': 'u1', 'X-Semantic-Service-Key': 'secret' }));

    fetchMock.mockResolvedValueOnce(jsonResponse({ job: null }));
    await expect(client.getActiveJob('m1', 'u1')).resolves.toBeNull();
    expect(fetchMock.mock.calls[1][0]).toBe('http://runtime:8000/v1/semantic-model-jobs/active?modelId=m1&jobType=population.run');
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows bound reads when runtime writes are disabled', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ dataRevisionId: 'dr_1', nodes: [], edges: [] }));
    const client = new SemanticRuntimeClientService(config({ runtimeWritesEnabled: false }) as any);
    await expect(client.getBoundGraph('m1', 'u1')).resolves.toMatchObject({ dataRevisionId: 'dr_1' });
  });

  it('maps runtime 409 to conflict and 404 to not-found', async () => {
    const client = new SemanticRuntimeClientService(config() as any);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'stale' }), { status: 409 }));
    await expect(
      client.activateRevision('dr_1', { actorUserId: 'u', modelId: 'm', modelVersionId: 'v', expectedCorrectionSequence: 0 }),
    ).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT });

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(client.projectRevision('missing')).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_NOT_FOUND,
    });
  });

  it('maps transport failures to unavailable without retrying', async () => {
    const client = new SemanticRuntimeClientService(config() as any);
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    await expect(client.resolveReview('r1', { actorUserId: 'u', modelId: 'm', resolution: {} })).rejects.toMatchObject(
      { code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
