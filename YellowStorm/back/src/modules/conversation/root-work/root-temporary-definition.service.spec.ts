import { RootTemporaryDefinitionService } from './root-temporary-definition.service';
import { resolvedDefinitionsDigest } from '../services/conversation-agent-request.builder';
import { freezeRootCapabilityCeiling } from './root-capability-ceiling';
import type { IGrpcAgent } from '../../agent/interfaces/agent.interface';

describe('root-derived temporary profile', () => {
  const rootId = '1'.repeat(24), parentId = '2'.repeat(24);
  const request = { nativeCallId: 'call', nativeCallBranch: 'spawn_temporary_worker@call', task: 'focused task' };
  function harness() {
    const root = { id: rootId, name: 'root', prompt: 'frozen instruction', save_memory: false,
      tools: [{ name: 'run_code' }, { name: 'search', accessToken: 'old-credential' }],
      chatbot: { model: 'chosen-model' }, brain_context: [{ workspace_id: 'own', workspace_documents: [] }],
      agent_params: { params: { platform_api_token: 'current-internal-secret' } }, connector_bindings: [] } as unknown as IGrpcAgent;
    const state = { actorId: 'owner', sessionId: 'conversation', invocationId: 'native', pendingInputs: [],
      requestProfile: { modelId: 'picked-model', semanticModelId: 'semantic', reasoningEffort: 'high',
        attachedFileIds: ['private-parent-attachment'], content: 'root original', skillIds: [], agentIds: [],
        webSearchEnabled: false, deepSearchEnabled: false, webConnectorAccessEnabled: false },
      scope: { immutableSnapshotRef: 'root-snapshot' }, rootContext: { temporary_workers_enabled: true },
      capabilityCeiling: freezeRootCapabilityCeiling(root), resolvedDefinitionsDigest: resolvedDefinitionsDigest(root, []) };
    const parent = { id: parentId, role: 'root', depth: 0, status: 'running', conversationId: 'conversation',
      rootAgentId: rootId, conversationEpoch: 4, resultPayload: { nativeState: state }, workGroupId: null };
    const work = { getExecution: jest.fn().mockResolvedValue(parent),
      registerExecution: jest.fn().mockImplementation(async (input) => ({ id: input.executionId })) };
    const conversations = { getConversationDocument: jest.fn().mockResolvedValue({ createdBy: 'owner',
      rootAgentId: rootId, rootWorkEpoch: 4 }) };
    const pool = { rootSnapshotDigest: 'root-snapshot', policy: { temporaryWorkers: { enabled: true } } };
    const resolver = { resolveForActor: jest.fn().mockResolvedValue(pool) };
    const agents = { buildAgentsForStream: jest.fn().mockResolvedValue([root]) };
    const semantic = { resolveChatModel: jest.fn().mockResolvedValue({ id: 'semantic', name: 'schema' }) };
    const settings = { getSettings: jest.fn().mockResolvedValue({ compaction: { enabled: false } }) };
    const shares = { assertUserHasAccess: jest.fn() };
    const sources = { buildSources: jest.fn().mockResolvedValue([]) };
    const jobs = { getOwnedHydration: jest.fn() };
    return { root, state, parent, work, conversations, pool, resolver, agents, semantic, shares, sources, jobs,
      service: new RootTemporaryDefinitionService(work as never, conversations as never, resolver as never,
        agents as never, semantic as never, settings as never, shares as never, sources as never, jobs as never) };
  }
  it('prepares a temporary background registration without creating an execution', async () => {
    const h = harness();
    const prepared = await h.service.prepareBackground(parentId, request);
    expect(prepared.registration?.role).toBe('temporary_worker');
    expect(prepared.registration?.nativeState.admittedRequest).toEqual({ ...request, expectedOutput: '', contextRefs: [] });
    expect(h.work.registerExecution).not.toHaveBeenCalled();
    expect(JSON.stringify(prepared.registration)).not.toContain('current-internal-secret');
  });

  it('uses the original chosen profile and creates only an ephemeral execution with isolated output', async () => {
    const h = harness();
    const result = await h.service.resolve(parentId, request);
    expect(h.agents.buildAgentsForStream).toHaveBeenCalledWith('owner', 'picked-model', [rootId], [], [],
      undefined, { id: 'semantic', name: 'schema' }, { conversationId: 'conversation', correlationId: 'call',
        playbookHandoffAttached: false }, 'high', undefined, false);
    expect(result.definition.id).toBe(result.executionId);
    expect(result.definition.chatbot).toEqual(h.root.chatbot);
    expect(result.definition.save_memory).toBe(false);
    expect(result.definition.agent_params!.params.enable_temporary_child_agents).toBe('false');
    expect(JSON.parse(result.definition.agent_params!.params.run_code_context_json)).toEqual({
      userId: 'owner', runId: result.executionId, sources: [] });
    expect(h.sources.buildSources).toHaveBeenCalledWith(['own'], []);
    expect(JSON.stringify(h.work.registerExecution.mock.calls)).not.toContain('credential');
    expect(JSON.stringify(h.work.registerExecution.mock.calls)).not.toContain('current-internal-secret');
    expect(JSON.stringify(h.work.registerExecution.mock.calls)).not.toContain('private-parent-attachment');
    expect(h.work.registerExecution).toHaveBeenCalledWith(expect.objectContaining({ role: 'temporary_worker', depth: 1 }));
    expect(h.work.registerExecution.mock.calls[0][0].nativeState.admittedRequest)
      .toEqual({ ...request, expectedOutput: '', contextRefs: [] });
  });
  it('accepts refreshed user credentials but rejects changed prompt/model definitions', async () => {
    const h = harness();
    h.root.tools[1].accessToken = 'fresh-credential';
    expect((await h.service.resolve(parentId, request)).definition.tools[1].accessToken).toBe('fresh-credential');
    h.root.prompt = 'changed instruction';
    await expect(h.service.resolve(parentId, request)).rejects.toThrow('profile changed');
  });

  it.each(['completed', 'failed', 'cancelled', 'outcome_unknown'])('rehydrates owned temporary work after foreground %s', async (rootStatus) => {
    const h = harness(); const first = await h.service.resolve(parentId, request);
    const admitted = h.work.registerExecution.mock.calls[0][0].nativeState;
    h.parent.status = rootStatus;
    const grant = { executionId: first.executionId, owner: 'owner', fence: 3 };
    const owned = { parent: h.parent, child: { id: first.executionId, role: 'temporary_worker' },
      request: admitted.admittedRequest, state: admitted,
      job: { fence: 3, nativeSessionId: 'background-session', nativeInvocationId: null,
        deadline: new Date(Date.now() + 60000), startedAt: null } };
    h.jobs.getOwnedHydration.mockResolvedValue(owned); h.work.registerExecution.mockClear();
    const hydrated = await h.service.resolveOwned(grant);
    expect(hydrated.definition.id).toBe(first.executionId);
    expect(hydrated.scope).toMatchObject({ expectedFence: '3', nativeSessionId: 'background-session', resumeIntent: 'start' });
    expect(h.work.registerExecution).not.toHaveBeenCalled();
    await expect(h.service.resolve(parentId, request)).rejects.toThrow('authority changed');
    owned.job.startedAt = new Date() as any;
    expect((await h.service.resolveOwned(grant)).scope.resumeIntent).toBe('attach');
    h.jobs.getOwnedHydration.mockReset().mockResolvedValueOnce(owned).mockRejectedValueOnce(new Error('lease expired'));
    await expect(h.service.resolveOwned(grant)).rejects.toThrow('lease expired');
    expect(h.work.registerExecution).not.toHaveBeenCalled();
  });
  it.each(['actor', 'epoch', 'binding', 'status', 'snapshot', 'opt-out'])('denies changed %s authority before hydration', async (change) => {
    const h = harness();
    if (change === 'actor') h.conversations.getConversationDocument.mockResolvedValue({ createdBy: 'other' } as never);
    if (change === 'epoch') h.parent.conversationEpoch = 3;
    if (change === 'binding') h.conversations.getConversationDocument.mockResolvedValue({ createdBy: 'owner', rootAgentId: 'other' } as never);
    if (change === 'status') h.parent.status = 'completed';
    if (change === 'snapshot') h.pool.rootSnapshotDigest = 'changed';
    if (change === 'opt-out') h.pool.policy.temporaryWorkers.enabled = false;
    await expect(h.service.resolve(parentId, request)).rejects.toThrow();
    expect(h.agents.buildAgentsForStream).not.toHaveBeenCalled();
  });
  it('denies unknown input references and Stop during asynchronous hydration', async () => {
    const h = harness();
    await expect(h.service.resolve(parentId, { ...request, contextRefs: ['private-parent-attachment'] })).rejects.toThrow('reference');
    expect(h.work.registerExecution).not.toHaveBeenCalled();
    h.agents.buildAgentsForStream.mockImplementation(async () => {
      h.conversations.getConversationDocument.mockResolvedValue({ createdBy: 'owner', rootAgentId: rootId, rootWorkEpoch: 5 });
      return [h.root];
    });
    await expect(h.service.resolve(parentId, request)).rejects.toThrow('authority changed');
    expect(h.work.registerExecution).not.toHaveBeenCalled();
  });
  it('denies impersonated native branch before loading private execution state', async () => {
    const h = harness();
    await expect(h.service.resolve(parentId, { ...request, nativeCallBranch: 'delegate_to_agent@call' })).rejects.toThrow('native branch');
    expect(h.work.getExecution).not.toHaveBeenCalled();
  });
  it('removes ambiguous smart-memory actions and denies revoked workspace access', async () => {
    const h = harness();
    h.root.connector_bindings = [{ connector_id: 'memory', connector_slug: 'smart-memory',
      actions: [{ action_key: 'mixed-read-write', execution_kind: 'leaf' }] }];
    h.root.tools.push({ name: 'smart-memory' });
    h.state.capabilityCeiling = freezeRootCapabilityCeiling(h.root);
    h.state.resolvedDefinitionsDigest = resolvedDefinitionsDigest(h.root, []);
    const result = await h.service.resolve(parentId, request);
    expect(result.definition.connector_bindings).toEqual([]);
    expect(result.definition.tools.some((tool) => tool.name === 'smart-memory')).toBe(false);
    h.shares.assertUserHasAccess.mockRejectedValueOnce(new Error('workspace revoked'));
    await expect(h.service.resolve(parentId, { ...request, nativeCallId: 'new', nativeCallBranch: 'spawn_temporary_worker@new' })).rejects.toThrow('revoked');
    expect(h.work.registerExecution).toHaveBeenCalledTimes(1);
  });
});
