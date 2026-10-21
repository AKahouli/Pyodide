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
  payload: { purpose: 'build', sources: [] },
};
const assetGrants = { admit: jest.fn().mockResolvedValue('signed-admission') };

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('SemanticRuntimeClientService (P2.11)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('builds actor/model/exact-document metadata handoffs for interactive calls only', async () => {
    const client = new SemanticRuntimeClientService(config() as never);
    const source = { workspaceId: 'workspace', assetId: 'document', originalName: 'contract.pdf',
      mimeType: 'application/pdf', sizeBytes: 123 };
    const injected = { actorUserId: 'spoof', modelId: 'other', sources: [] };
    fetchMock.mockImplementation(async () => jsonResponse({ status: 'read', fields: {} }));
    await client.previewDocumentFields({ actorUserId: 'actor', modelId: 'model',
      entry: { conceptId: 'concept', source, fieldMappings: [] }, ...{ authorizedMetadata: injected } });
    await client.suggestDocumentFields({ actorUserId: 'actor', modelId: 'model', sources: [source],
      concept: { id: 'concept', label: 'Concept', description: '', attributes: [] },
      ...{ authorizedMetadata: injected } });
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.headers['X-Semantic-Service-Key']).toBe('secret');
      expect(JSON.parse(options.body).authorizedMetadata).toEqual({
        actorUserId: 'actor', modelId: 'model', sources: [source],
      });
    }
    expect(assetGrants.admit).not.toHaveBeenCalled();
  });

  it('preserves safe diagnostic details through authenticated job and index status reads', async () => {
    const errorDetails = { code: 'DataError', errorType: 'DataError', message: 'Database argument has an incompatible type.',
      occurredAt: '2026-10-15T09:02:15Z', jobId: 'job-1', sqlState: '22000',
      frames: [{ file: 'app/graph_search/indexer.py', function: 'build_index', line: 203 }] };
    const client = new SemanticRuntimeClientService(config() as never);
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobId: 'job-1', state: 'failed', errorCode: 'attempts_exhausted', errorDetails }));
    await expect(client.getJob('job-1', 'u1')).resolves.toMatchObject({ errorDetails });
    fetchMock.mockResolvedValueOnce(jsonResponse({ modelId: 'm1', index: { state: 'failed', lastErrorCode: 'attempts_exhausted', errorDetails } }));
    await expect(client.getGraphSearchIndex('m1', 'draft', 'u1')).resolves.toMatchObject({ index: { errorDetails } });
    expect(fetchMock.mock.calls.every(([, options]) => options.headers['X-Actor-User-Id'] === 'u1')).toBe(true);
  });

  describe('runtime-owned AI extraction profile', () => {
    const identity = { profileId: 'semantic-runtime', model: 'openai/extractor', contractVersion: 'ai-attribute-v2',
      promptVersion: 'semantic-attributes-v1', maxTokens: 4096 };

    it('reads the authenticated profile with writes disabled and forwards only non-secret identity', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ...identity, apiKey: 'not-forwarded' }));
      const timeout = jest.spyOn(AbortSignal, 'timeout');
      const client = new SemanticRuntimeClientService(config({ runtimeWritesEnabled: false }) as never);
      await expect(client.getAiExtractionIdentity()).resolves.toEqual(identity);
      expect(fetchMock).toHaveBeenCalledWith('http://runtime:8000/v1/semantic-model-population/ai-extraction/profile', {
        method: 'GET', headers: { 'X-Semantic-Service-Key': 'secret' }, signal: expect.any(AbortSignal),
      });
      expect(timeout).toHaveBeenCalledWith(5000);
      timeout.mockRestore();
    });

    it('accepts the generated-value prompt identity and preserves it for fingerprints', async () => {
      const generated = { ...identity, promptVersion: 'semantic-attributes-v2' };
      fetchMock.mockResolvedValueOnce(jsonResponse(generated));
      await expect(new SemanticRuntimeClientService(config() as never).getAiExtractionIdentity()).resolves.toEqual(generated);
    });

    it.each([503, 404, 401])('fails closed when the profile endpoint returns %s', async (status) => {
      fetchMock.mockResolvedValueOnce(new Response('{}', { status }));
      await expect(new SemanticRuntimeClientService(config() as never).getAiExtractionIdentity())
        .rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([null, {}, { ...identity, model: '' }, { ...identity, profileId: 'agent' },
      { ...identity, contractVersion: 'ai-attribute-v1' }, { ...identity, promptVersion: 'wrong' },
      { ...identity, maxTokens: 0 }, { ...identity, maxTokens: 1.5 }, { ...identity, maxTokens: '4096' }])
      ('rejects malformed or incompatible identity %j', async (payload) => {
        fetchMock.mockResolvedValueOnce(jsonResponse(payload));
        await expect(new SemanticRuntimeClientService(config() as never).getAiExtractionIdentity())
          .rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE });
      });

    it('rejects malformed JSON and unreachable profiles without retrying', async () => {
      const client = new SemanticRuntimeClientService(config() as never);
      fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
      await expect(client.getAiExtractionIdentity()).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE });
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(client.getAiExtractionIdentity()).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('requires runtime configuration without requesting a profile', async () => {
      await expect(new SemanticRuntimeClientService(config({ runtimeServiceKey: '' }) as never).getAiExtractionIdentity())
        .rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('posts population runs with service key, idempotency key and timeout', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobId: 'j1', reused: false }));
    const client = new SemanticRuntimeClientService(config() as any, assetGrants as never);
    const result = await client.requestPopulationRun(runCommand, 'idem-1');
    expect(result).toEqual({ jobId: 'j1', reused: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://runtime:8000/v1/semantic-model-population/runs');
    expect(JSON.parse(init.body)).toEqual({ ...runCommand, payload: { ...runCommand.payload, assetAdmission: 'signed-admission', assetCommand: JSON.stringify(runCommand) } });
    expect(assetGrants.admit).toHaveBeenCalledWith('u1', 'm1', 'population', [], 'idem-1', runCommand);
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

  it('allows bound reads when runtime writes are disabled, scoped to the allowed workspaces', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ dataRevisionId: 'dr_1', nodes: [], edges: [] }));
    const client = new SemanticRuntimeClientService(config({ runtimeWritesEnabled: false }) as any);
    await expect(client.getBoundGraph('m1', 'u1', undefined, ['ws-1'])).resolves.toMatchObject({ dataRevisionId: 'dr_1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://runtime:8000/v1/semantic-model-population/models/m1/graph/read');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ actorUserId: 'u1', environment: 'draft', allowedWorkspaceIds: ['ws-1'] });
    expect(init.headers).toEqual(expect.objectContaining({ 'X-Semantic-Service-Key': 'secret', 'X-Actor-User-Id': 'u1' }));
  });

  it('reads a bounded graph window with the scope, limit, concept and focus', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ dataRevisionId: 'dr_1', nodes: [], edges: [], truncated: false, nodeLimit: 50, totals: null }));
    const client = new SemanticRuntimeClientService(config() as any);
    await client.getBoundGraphWindow('m1', 'u1', ['ws-1'], { nodeLimit: 50, conceptId: 'c1', focusIds: ['r1'], neighbours: false, dataRevisionId: 'dr_1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://runtime:8000/v1/semantic-model-population/models/m1/graph/window');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      actorUserId: 'u1', environment: 'draft', allowedWorkspaceIds: ['ws-1'],
      dataRevisionId: 'dr_1', nodeLimit: 50, conceptId: 'c1', focusIds: ['r1'], neighbours: false,
    });
  });

  it('sends the depth around a focus record only when it is deeper than one link', async () => {
    const window = { dataRevisionId: 'dr_1', nodes: [], edges: [], truncated: false, nodeLimit: 5000, totals: null };
    fetchMock.mockResolvedValueOnce(jsonResponse(window)).mockResolvedValueOnce(jsonResponse(window));
    const client = new SemanticRuntimeClientService(config() as any);
    await client.getBoundGraphWindow('m1', 'u1', ['ws-1'], { nodeLimit: 5000, focusIds: ['r1'], depth: 8 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      actorUserId: 'u1', environment: 'draft', allowedWorkspaceIds: ['ws-1'], nodeLimit: 5000, focusIds: ['r1'], depth: 8,
    });
    await client.getBoundGraphWindow('m1', 'u1', ['ws-1'], { focusIds: ['r1'], depth: 1 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('depth');
  });

  it('refuses to read a graph window without a workspace scope', async () => {
    const client = new SemanticRuntimeClientService(config() as any);
    await expect(client.getBoundGraphWindow('m1', 'u1', undefined as unknown as string[])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to read the graph without a workspace scope', async () => {
    const client = new SemanticRuntimeClientService(config() as any);
    await expect(client.getBoundGraph('m1', 'u1', undefined, undefined as unknown as string[])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
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

  it('says why the runtime refused a run, and that it cannot be reached when it is down', async () => {
    const client = new SemanticRuntimeClientService(config() as any, assetGrants as never);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: [
      { loc: ['body', 'payload', 'sources'], msg: 'Value error, a run reads at least one source' },
    ] }), { status: 422 }));
    await expect(client.requestPopulationRun(runCommand as any, 'k')).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
      message: 'The semantic runtime refused the request (payload › sources: a run reads at least one source).',
    });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client.requestPopulationRun(runCommand as any, 'k')).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
      message: expect.stringMatching(/cannot be reached right now/),
    });
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

      // The progress of a build (camelCase, optional) reaches the caller as the runtime sent it.
      const building = { state: 'indexing', stage: 'embedding', expectedCount: 8400, indexedCount: 1200, exactOnlyCount: 0, passageCount: 300, passageIndexedCount: 20, loadedCount: 8400,
        buildMode: 'incremental', buildReason: null, carriedCount: 8250, rebuiltCount: 150, embeddedCount: 40 };
      fetchMock.mockResolvedValueOnce(jsonResponse({ index: building }));
      await expect(client.getGraphSearchIndex('m1', 'draft', 'u1')).resolves.toEqual({ index: building });
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

    it('sends retry identity and preserves explicit stale conflicts from the runtime', async () => {
      const client = new SemanticRuntimeClientService(config() as any);
      const body = { actorUserId: 'u1', modelId: 'm1', environment: 'draft' as const, expectedDataRevisionId: 'dr-1', expectedIndexId: 'ix-1' };
      fetchMock.mockResolvedValueOnce(jsonResponse({ index: { state: 'queued' } }));
      await client.ensureGraphSearchIndex(body);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body);
      for (const detail of ['revision_changed', 'index_identity_changed']) {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail }), { status: 409 }));
        await expect(client.ensureGraphSearchIndex(body)).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT });
      }
    });

    it('stops an index build through the runtime, which needs writes on', async () => {
      const disabled = new SemanticRuntimeClientService(config({ runtimeWritesEnabled: false }) as any);
      await expect(disabled.stopGraphSearchIndex({ actorUserId: 'u1', modelId: 'm1', environment: 'draft' }))
        .rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE });
      expect(fetchMock).not.toHaveBeenCalled();

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ stopped: true, index: { state: 'indexing' } }), { status: 200 }));
      const client = new SemanticRuntimeClientService(config() as any);
      await expect(client.stopGraphSearchIndex({ actorUserId: 'u1', modelId: 'm1', environment: 'draft' }))
        .resolves.toMatchObject({ stopped: true });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://runtime:8000/v1/semantic-model-search/indexes/stop');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ actorUserId: 'u1', modelId: 'm1', environment: 'draft' });
    });

    it('restarts an index build through the runtime, which needs writes on', async () => {
      const disabled = new SemanticRuntimeClientService(config({ runtimeWritesEnabled: false }) as any);
      await expect(disabled.restartGraphSearchIndex({ actorUserId: 'u1', modelId: 'm1', environment: 'draft' }))
        .rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE });
      expect(fetchMock).not.toHaveBeenCalled();

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ restarted: true, jobId: 'j2', index: { state: 'queued' } }), { status: 202 }));
      const client = new SemanticRuntimeClientService(config() as any);
      await expect(client.restartGraphSearchIndex({ actorUserId: 'u1', modelId: 'm1', environment: 'draft' }))
        .resolves.toMatchObject({ restarted: true, jobId: 'j2' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://runtime:8000/v1/semantic-model-search/indexes/restart');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ actorUserId: 'u1', modelId: 'm1', environment: 'draft' });
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

describe('SemanticRuntimeClientService purgeModelData', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the purge time in the body and waits that long plus ten seconds', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(new Response(JSON.stringify({ modelId: 'm1', revisions: 0, jobs: 0 }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const client = new SemanticRuntimeClientService(config() as any);
    await client.purgeModelData('m1', 'u1', { forgetDocumentReading: true, timeoutSeconds: 600 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://runtime:8000/v1/semantic-model-population/models/m1/purge');
    expect(JSON.parse(init.body)).toEqual({ forgetDocumentReading: true, timeoutSeconds: 600 });
    expect(timeout).toHaveBeenCalledWith(610_000);
  });
});

describe('SemanticRuntimeClientService cloneModelData', () => {
  let fetchMock: jest.Mock;
  const command = { targetModelId: 't1', targetModelVersionId: 'v1', allowedWorkspaceIds: ['ws-1'], idMap: { concepts: { a: 'b' }, relations: {}, mappings: {} } };
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
