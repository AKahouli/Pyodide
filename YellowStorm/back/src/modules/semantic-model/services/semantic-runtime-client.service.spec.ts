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

  describe('graph search', () => {
    const query = {
      actorUserId: 'u1', modelId: 'm1', environment: 'production' as const, query: 'acme', allowedWorkspaceIds: ['ws-1'],
    };

    it('searches as the actor with a longer deadline, even while runtime writes are off', async () => {
      const timeout = jest.spyOn(AbortSignal, 'timeout');
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'found', seeds: [] }));
      const client = new SemanticRuntimeClientService(config({ runtimeWritesEnabled: false }) as any);
      await expect(client.graphSearch(query)).resolves.toMatchObject({ status: 'found' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://runtime:8000/v1/semantic-model-search/query');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual(query);
      expect(init.headers).toEqual(expect.objectContaining({ 'X-Semantic-Service-Key': 'secret', 'X-Actor-User-Id': 'u1' }));
      expect(timeout).toHaveBeenCalledWith(15_000);
      timeout.mockRestore();
    });

    it('expands and reads the index state', async () => {
      const client = new SemanticRuntimeClientService(config() as any);
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'found', nodes: [], edges: [] }));
      await client.graphExpand({ actorUserId: 'u1', modelId: 'm1', environment: 'draft', seedEntityIds: ['e1'], steps: [{ direction: 'both' }] });
      expect(fetchMock.mock.calls[0][0]).toBe('http://runtime:8000/v1/semantic-model-search/expand');

      fetchMock.mockResolvedValueOnce(jsonResponse({ index: { state: 'ready' } }));
      await expect(client.getGraphSearchIndex('m/1', 'draft', 'u1')).resolves.toMatchObject({ index: { state: 'ready' } });
      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toBe('http://runtime:8000/v1/semantic-model-search/models/m%2F1/index?environment=draft');
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
    });

    it('builds an index only when runtime writes are on', async () => {
      const disabled = new SemanticRuntimeClientService(config({ runtimeWritesEnabled: false }) as any);
      await expect(disabled.ensureGraphSearchIndex({ actorUserId: 'u1', modelId: 'm1', environment: 'production' }))
        .rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE });
      expect(fetchMock).not.toHaveBeenCalled();

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'j1', index: { state: 'queued' } }), { status: 202 }));
      const client = new SemanticRuntimeClientService(config() as any);
      await expect(client.ensureGraphSearchIndex({ actorUserId: 'u1', modelId: 'm1', environment: 'production' }))
        .resolves.toMatchObject({ jobId: 'j1' });
      expect(fetchMock.mock.calls[0][0]).toBe('http://runtime:8000/v1/semantic-model-search/indexes');
    });

    it('maps refused requests, missing bindings, revision changes and outages', async () => {
      const client = new SemanticRuntimeClientService(config() as any);
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'unknown_relation' }), { status: 422 }));
      await expect(client.graphSearch(query)).rejects.toMatchObject({
        code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, message: 'One of the relationships named is not in this model',
      });
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: [{ loc: ['body', 'query'] }] }), { status: 422 }));
      await expect(client.graphSearch(query)).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED });
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'model_not_published' }), { status: 404 }));
      await expect(client.graphSearch(query)).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_NOT_FOUND });
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'active_binding_changed' }), { status: 409 }));
      await expect(client.graphSearch(query)).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT });
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'age_projection_unavailable' }), { status: 503 }));
      await expect(client.graphSearch(query)).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE });
      fetchMock.mockRejectedValueOnce(new Error('timeout'));
      await expect(client.graphSearch(query)).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE });
    });

    it('queries and describes records as the actor, and says when a query is too slow', async () => {
      const client = new SemanticRuntimeClientService(config({ runtimeWritesEnabled: false }) as any);
      const body = {
        actorUserId: 'u1', modelId: 'm1', environment: 'draft' as const, allowedWorkspaceIds: ['ws-1'], concept: 'Invoice',
        filters: [{ field: 'amount', op: 'gt', value: 10 }], catalog: { concepts: [], relations: [] },
      };
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok', total: 0 }));
      await expect(client.recordsQuery(body)).resolves.toMatchObject({ status: 'ok' });
      expect(fetchMock.mock.calls[0][0]).toBe('http://runtime:8000/v1/semantic-model-search/records-query');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body);
      expect(fetchMock.mock.calls[0][1].headers).toEqual(expect.objectContaining({ 'X-Actor-User-Id': 'u1' }));
      fetchMock.mockResolvedValueOnce(jsonResponse({ concepts: [], relations: [] }));
      await client.recordsOverview({ actorUserId: 'u1', modelId: 'm1', environment: 'production', allowedWorkspaceIds: [] });
      expect(fetchMock.mock.calls[1][0]).toBe('http://runtime:8000/v1/semantic-model-search/records-overview');
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'query_too_slow' }), { status: 422 }));
      await expect(client.recordsQuery(body)).rejects.toMatchObject({
        code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, message: expect.stringMatching(/took too long/),
      });
    });
  });

  it('previews a computed field and maps a runtime 422 to a validation error', async () => {
    const client = new SemanticRuntimeClientService(config() as any);
    const body = { computed: { input: { kind: 'file', name: 'document_name' }, method: 'split', delimiter: '_', part: 1 }, samples: ['A_B.pdf'] };
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ input: 'A_B.pdf', value: 'A', reason: 'found' }] }));
    await expect(client.previewComputedField(body)).resolves.toEqual({ results: [{ input: 'A_B.pdf', value: 'A', reason: 'found' }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://runtime:8000/v1/semantic-model-population/computed-preview');
    expect(JSON.parse(init.body)).toEqual(body);
    expect(init.headers).toEqual(expect.objectContaining({ 'X-Semantic-Service-Key': 'secret' }));

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'invalid_computed: part must not be 0' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }));
    await expect(client.previewComputedField(body)).rejects.toMatchObject({ message: expect.stringContaining('invalid_computed') });
  });
});

describe('SemanticRuntimeClientService deleteModel', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('sends a service-key DELETE for the model', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new SemanticRuntimeClientService(config() as any);
    await expect(client.deleteModel('m 1', 'u1')).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://runtime:8000/v1/semantic-model-population/models/m%201');
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual(expect.objectContaining({ 'X-Semantic-Service-Key': 'secret', 'X-Actor-User-Id': 'u1' }));
  });

  it('turns a running job into a clear 409', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'model_jobs_running' }), { status: 409 }));
    const client = new SemanticRuntimeClientService(config() as any);
    await expect(client.deleteModel('m1', 'u1')).rejects.toMatchObject({ status: 409 });
  });

  it('fails closed when the runtime cannot purge', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const client = new SemanticRuntimeClientService(config() as any);
    await expect(client.deleteModel('m1', 'u1')).rejects.toMatchObject({ status: 503 });
  });

  it('skips when no runtime is configured', async () => {
    const client = new SemanticRuntimeClientService(config({ runtimeEnabled: false }) as any);
    await expect(client.deleteModel('m1', 'u1')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('SemanticRuntimeClientService cloneModelData', () => {
  let fetchMock: jest.Mock;
  const command = { targetModelId: 't1', targetModelVersionId: 'v1', idMap: { concepts: { a: 'b' }, relations: {}, mappings: {} } };
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('posts the id map to the clone-data route with the service key', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ copied: true, counts: { entities: 2, relationships: 1 } }), { status: 200 }));
    const client = new SemanticRuntimeClientService(config() as any);
    await expect(client.cloneModelData('s1', command, 'u1')).resolves.toMatchObject({ copied: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://runtime:8000/v1/semantic-model-population/models/s1/clone-data');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(command);
    expect(init.headers).toEqual(expect.objectContaining({ 'X-Semantic-Service-Key': 'secret', 'X-Actor-User-Id': 'u1' }));
  });

  it('turns a running source job into a 409 and other failures into a 503', async () => {
    const client = new SemanticRuntimeClientService(config() as any);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'model_jobs_running' }), { status: 409 }));
    await expect(client.cloneModelData('s1', command, 'u1')).rejects.toMatchObject({ status: 409 });
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(client.cloneModelData('s1', command, 'u1')).rejects.toMatchObject({ status: 503 });
  });

  it('skips when no runtime is configured', async () => {
    const client = new SemanticRuntimeClientService(config({ runtimeEnabled: false }) as any);
    await expect(client.cloneModelData('s1', command, 'u1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
