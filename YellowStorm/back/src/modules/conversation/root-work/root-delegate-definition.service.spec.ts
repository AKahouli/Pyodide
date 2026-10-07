import { RootDelegateDefinitionService } from './root-delegate-definition.service';
import { freezeRootCapabilityCeiling } from './root-capability-ceiling';
import type { IGrpcAgent } from '../../agent/interfaces/agent.interface';
import { createHash } from 'node:crypto';
import { ConversationRootResolverService } from './conversation-root-resolver.service';

describe('lazy selected root delegate definition', () => {
  const parentId = '1'.repeat(24), agentId = '2'.repeat(24);
  const request = { agentId, task: 'bounded task', nativeCallId: 'native-call',
    nativeCallBranch: 'delegate_to_agent@native-call' };
  const definition = { id: agentId, tools: [], brain_context: [], skills: [],
    agent_params: { params: { platform_api_token: 'fresh-credential' } } } as unknown as IGrpcAgent;
  function harness() {
    const state = { actorId: 'actor', sessionId: 'session', invocationId: 'invocation', pendingInputs: [],
      scope: { immutableSnapshotRef: 'root-snapshot' }, capabilityCeiling: freezeRootCapabilityCeiling(definition),
      rootContext: { catalog: [{ agent_id: agentId, snapshot_digest: 'worker-snapshot', configuration_mode: 'native' }] } };
    const work = { getExecution: jest.fn().mockResolvedValue({ id: parentId, conversationId: 'conversation',
      rootAgentId: parentId, role: 'root', depth: 0, status: 'running', conversationEpoch: 4,
      resultPayload: { nativeState: state } }),
      registerExecution: jest.fn().mockImplementation(async (input) => ({ id: input.executionId })) };
    const conversations = { getConversationDocument: jest.fn().mockResolvedValue({ createdBy: 'actor',
      rootAgentId: parentId, rootWorkEpoch: 4, isGroup: false, isArchived: false }) };
    const pool = { delegationEnabled: true, rootSnapshotDigest: 'root-snapshot', entries: [{ agentId,
      snapshotDigest: 'worker-snapshot', configurationMode: 'native', source: { direct: false, teamIds: ['team'] } }] };
    const resolver = { resolveForActor: jest.fn().mockResolvedValue(pool) };
    const agents = { buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([definition]) };
    const shares = { assertUserHasAccess: jest.fn() };
    const sources = { buildSources: jest.fn().mockResolvedValue([]) };
    const jobs = { getOwnedHydration: jest.fn(), getOwnedFanoutItem: jest.fn(), registerOwnedFanoutItem: jest.fn() };
    const documents = { findAllByWorkspace: jest.fn().mockResolvedValue({ documents: [{ id: 'document', path: 'fixture.pdf', filename: 'fixture.pdf' }], pagination: { total: 1 } }) };
    return { state, work, conversations, pool, resolver, agents, shares, sources, jobs, documents,
      service: new RootDelegateDefinitionService(work as any, conversations as any, resolver as any, agents as any,
        shares as any, sources as any, jobs as any, documents as any) };
  }

  it('rehydrates a manifest-selected item after foreground completion and rechecks ownership before registration', async () => {
    const h = harness();
    Object.assign(h.pool, { policy: { background: { enabled: true }, fanout: { enabled: true, allowBackground: true } } });
    const parent = await h.work.getExecution(); parent.status = 'completed';
    const executionId = createHash('sha256').update(`${parentId}:${request.nativeCallBranch}`).digest('hex').slice(0, 24);
    const grant = { executionId: 'coordinator', owner: 'owner', fence: 2, nativeOwner: 'native' };
    const owned = { parent, role: 'library_worker', request: { ...request, expectedOutput: '', contextRefs: [] },
      job: { nativeSessionId: 'coordinator-session' } };
    h.jobs.getOwnedFanoutItem.mockResolvedValue(owned);
    h.jobs.registerOwnedFanoutItem.mockImplementation(async (_grant, input) => ({ id: input.executionId,
      resultPayload: { nativeState: { ...input.nativeState, scope: { ...input.nativeState.scope, expectedFence: '2' } } } }));
    const result = await h.service.resolveFanoutItem(grant, executionId);
    expect(result.scope).toMatchObject({ executionId, parentExecutionId: parentId, depth: 1, expectedFence: '2' });
    expect(h.agents.buildGrpcAgentsForPlaybook).toHaveBeenCalledWith('actor', [agentId], undefined,
      'coordinator-session', expect.any(Object));
    expect(h.jobs.registerOwnedFanoutItem).toHaveBeenCalledWith({ ...grant, producerExecutionId: executionId },
      expect.objectContaining({ executionId, nativeState: expect.objectContaining({ admittedRequest: owned.request }) }));
    expect(h.work.registerExecution).not.toHaveBeenCalled();
    expect(JSON.stringify(h.jobs.registerOwnedFanoutItem.mock.calls)).not.toContain('fresh-credential');
    h.jobs.registerOwnedFanoutItem.mockClear();
    h.jobs.getOwnedFanoutItem.mockReset().mockResolvedValueOnce(owned).mockRejectedValueOnce(new Error('lease changed'));
    await expect(h.service.resolveFanoutItem(grant, executionId)).rejects.toThrow('lease changed');
    expect(h.jobs.registerOwnedFanoutItem).not.toHaveBeenCalled();
  });

  it('rejects missing native ownership and current fan-out opt-out before selected definition hydration', async () => {
    const h = harness();
    await expect(h.service.resolveFanoutItem({ executionId: 'coordinator', owner: 'owner', fence: 1 }, 'item'))
      .rejects.toThrow('native ownership');
    expect(h.jobs.getOwnedFanoutItem).not.toHaveBeenCalled();
    await expect(h.service.resolveFanoutItem({ executionId: 'coordinator', owner: 'owner', fence: 1,
      nativeOwner: 'native', producerExecutionId: 'other-item' }, 'item')).rejects.toThrow('producer binding');
    expect(h.jobs.getOwnedFanoutItem).not.toHaveBeenCalled();
    Object.assign(h.pool, { policy: { background: { enabled: true }, fanout: { enabled: true, allowBackground: false } } });
    h.jobs.getOwnedFanoutItem.mockResolvedValue({ parent: { id: parentId }, role: 'library_worker',
      request, job: { nativeSessionId: 'coordinator-session' } });
    await expect(h.service.resolveFanoutItem({ executionId: 'coordinator', owner: 'owner', fence: 1, nativeOwner: 'native' }, 'item'))
      .rejects.toThrow('fan-out authority');
    expect(h.agents.buildGrpcAgentsForPlaybook).not.toHaveBeenCalled();
  });

  it('prepares the frozen background registration without consuming an execution allowance', async () => {
    const h = harness();
    const prepared = await h.service.prepareBackground(parentId, request);
    expect(prepared.registration?.nativeState.admittedRequest).toEqual({ ...request, expectedOutput: '', contextRefs: [] });
    expect(h.work.registerExecution).not.toHaveBeenCalled();
    expect(JSON.stringify(prepared.registration)).not.toContain('fresh-credential');
  });

  it('hydrates only the selected worker workspaces remaining inside the frozen ceiling', async () => {
    const h = harness();
    h.pool.entries[0].configurationMode = 'root_constrained';
    h.state.rootContext.catalog[0].configuration_mode = 'root_constrained';
    h.state.capabilityCeiling.workspaceIds = ['approved'];
    h.agents.buildGrpcAgentsForPlaybook.mockResolvedValue([{ ...definition, brain_context: [
      { workspace_id: 'approved', workspace_documents: [] },
      { workspace_id: 'excluded', workspace_documents: [] },
    ] } as never]);
    const result = await h.service.resolve(parentId, request);
    expect(h.documents.findAllByWorkspace).toHaveBeenCalledTimes(1);
    expect(h.documents.findAllByWorkspace).toHaveBeenCalledWith('approved', { limit: 1000, status: 'completed' });
    expect(result.definition.brain_context).toEqual([expect.objectContaining({ workspace_id: 'approved',
      workspace_documents: [expect.objectContaining({ _id: 'document', workspace_id: 'approved', filepath: 'fixture.pdf' })] })]);
    expect(h.shares.assertUserHasAccess).toHaveBeenCalledWith('actor', ['approved']);
  });

  it('rejects ordinary source denial before reading document metadata and rejects truncated document sets', async () => {
    const h = harness();
    h.agents.buildGrpcAgentsForPlaybook.mockResolvedValue([{ ...definition,
      brain_context: [{ workspace_id: 'approved', workspace_documents: [] }] } as never]);
    h.shares.assertUserHasAccess.mockRejectedValueOnce(new Error('source denied'));
    await expect(h.service.resolve(parentId, request)).rejects.toThrow('source denied');
    expect(h.documents.findAllByWorkspace).not.toHaveBeenCalled();
    h.documents.findAllByWorkspace.mockResolvedValueOnce({ documents: [], pagination: { total: 1001 } });
    await expect(h.service.resolve(parentId, request)).rejects.toThrow('bounded hydration limit');
    expect(h.work.registerExecution).not.toHaveBeenCalled();
  });

  it('rechecks governed source authorization after asynchronous document hydration', async () => {
    const h = harness();
    h.conversations.getConversationDocument.mockResolvedValue({ createdBy: 'actor', rootAgentId: parentId,
      rootWorkEpoch: 4, isGroup: false, isArchived: false, runtimeMode: 'governed' } as never);
    const hydrated = { ...definition, brain_context: [{ workspace_id: 'approved', workspace_documents: [] }] };
    Object.assign(h.resolver, { restrictDefinition: jest.fn().mockResolvedValue(hydrated),
      assertWorkspaces: jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('source revoked')) });
    h.agents.buildGrpcAgentsForPlaybook.mockResolvedValue([hydrated as never]);
    await expect(h.service.resolve(parentId, request)).rejects.toThrow('source revoked');
    expect(h.documents.findAllByWorkspace).toHaveBeenCalledWith('approved', expect.any(Object));
    expect(h.shares.assertUserHasAccess).not.toHaveBeenCalled();
    expect(h.work.registerExecution).not.toHaveBeenCalled();
  });

  it('rejects owned replay when the selected document set changes after admission', async () => {
    const h = harness();
    h.agents.buildGrpcAgentsForPlaybook.mockResolvedValue([{ ...definition,
      brain_context: [{ workspace_id: 'approved', workspace_documents: [] }] } as never]);
    const prepared = await h.service.prepareBackground(parentId, request);
    h.jobs.getOwnedHydration.mockResolvedValue({ child: { id: prepared.executionId, role: 'library_worker' },
      parent: { id: parentId }, request, state: prepared.registration!.nativeState,
      job: { nativeSessionId: 'session' } });
    h.documents.findAllByWorkspace.mockResolvedValue({ documents: [], pagination: { total: 0 } });
    await expect(h.service.resolveOwned({ executionId: prepared.executionId, owner: 'owner', fence: 1 }))
      .rejects.toThrow('Owned worker definition changed');
  });

  it('rejects governed source revocation while run-code mounts are prepared', async () => {
    const h = harness();
    let revoked = false;
    h.conversations.getConversationDocument.mockResolvedValue({ createdBy: 'actor', rootAgentId: parentId,
      rootWorkEpoch: 4, isGroup: false, isArchived: false, runtimeMode: 'governed' } as never);
    const authority = new ConversationRootResolverService(h.conversations as never, {} as never,
      { resolveRuntime: async () => ({ workspaceIds: revoked ? [] : ['approved'] }) } as never, {} as never, {} as never);
    Object.assign(h.resolver, { restrictDefinition: authority.restrictDefinition.bind(authority),
      authorizedWorkspaces: authority.authorizedWorkspaces.bind(authority), assertWorkspaces: authority.assertWorkspaces.bind(authority) });
    h.agents.buildGrpcAgentsForPlaybook.mockResolvedValue([{ ...definition, tools: [{ name: 'run_code' }],
      brain_context: [{ workspace_id: 'approved', workspace_documents: [{ workspace_id: 'approved', filepath: 'fixture.pdf' }] }] } as never]);
    h.sources.buildSources.mockImplementation(async () => { await Promise.resolve(); revoked = true; return []; });
    await expect(h.service.resolve(parentId, request)).rejects.toThrow('Governed source access changed');
    expect(h.work.registerExecution).not.toHaveBeenCalled();
    expect(h.shares.assertUserHasAccess).not.toHaveBeenCalled();
  });

  it('hydrates only the selected Team-authorized specialist without root overrides', async () => {
    const h = harness();
    const resolved = await h.service.resolve(parentId, request);
    expect(h.agents.buildGrpcAgentsForPlaybook).toHaveBeenCalledWith('actor', [agentId], undefined, 'session',
      expect.objectContaining({ scopeType: 'conversation' }));
    expect(h.resolver.resolveForActor).toHaveBeenCalledTimes(3);
    expect(resolved.executionId).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.stringify(h.work.registerExecution.mock.calls)).not.toContain('fresh-credential');
    expect(resolved.definition).toBe(definition);
    expect(h.work.registerExecution.mock.calls[0][0].nativeState.admittedRequest)
      .toEqual({ ...request, expectedOutput: '', contextRefs: [] });
  });

  it.each(['completed', 'failed', 'cancelled', 'outcome_unknown'])('rehydrates owned work after foreground %s without new admission', async (rootStatus) => {
    const h = harness();
    h.agents.buildGrpcAgentsForPlaybook.mockImplementation(async (_actor, _ids, _context, sessionId) => [{
      ...definition, agent_params: { params: { ...definition.agent_params!.params, session_id: sessionId } },
    }]);
    const first = await h.service.resolve(parentId, request);
    const admitted = h.work.registerExecution.mock.calls[0][0].nativeState;
    const parent = await h.work.getExecution(); parent.status = rootStatus;
    const grant = { executionId: first.executionId, owner: 'owner', fence: 2 };
    const owned = { parent, child: { id: first.executionId, role: 'library_worker' },
      request: admitted.admittedRequest, state: admitted,
      job: { fence: 2, nativeSessionId: 'background-session', nativeInvocationId: 'saved-invocation',
        deadline: new Date(Date.now() + 60000), startedAt: new Date() } };
    h.jobs.getOwnedHydration.mockResolvedValue(owned); h.work.registerExecution.mockClear();
    const hydrated = await h.service.resolveOwned(grant);
    expect(hydrated.scope).toMatchObject({ expectedFence: '2', nativeSessionId: 'background-session',
      nativeInvocationId: 'saved-invocation', resumeIntent: 'resume' });
    expect(hydrated.definition.agent_params!.params.session_id).toBe('background-session');
    expect(h.work.registerExecution).not.toHaveBeenCalled();
    expect(h.agents.buildGrpcAgentsForPlaybook).toHaveBeenLastCalledWith('actor', [agentId], undefined,
      'background-session', expect.any(Object));
    await expect(h.service.resolve(parentId, request)).rejects.toThrow('cannot admit');
    owned.job.nativeInvocationId = null as any;
    expect((await h.service.resolveOwned(grant)).scope.resumeIntent).toBe('attach');
    h.jobs.getOwnedHydration.mockReset().mockResolvedValueOnce(owned).mockRejectedValueOnce(new Error('owner revoked'));
    await expect(h.service.resolveOwned(grant)).rejects.toThrow('owner revoked');
    expect(h.work.registerExecution).not.toHaveBeenCalled();
  });

  it.each(['actor', 'epoch', 'binding', 'revocation', 'definition'])('denies changed %s before hydration', async (changed) => {
    const h = harness();
    const conversation = await h.conversations.getConversationDocument();
    if (changed === 'actor') conversation.createdBy = 'other';
    if (changed === 'epoch') conversation.rootWorkEpoch++;
    if (changed === 'binding') conversation.rootAgentId = agentId;
    if (changed === 'revocation') h.pool.entries = [];
    if (changed === 'definition') h.pool.entries[0].snapshotDigest = 'changed';
    await expect(h.service.resolve(parentId, request)).rejects.toThrow();
    expect(h.agents.buildGrpcAgentsForPlaybook).not.toHaveBeenCalled();
  });

  it('rechecks authority after hydration and lets atomic admission reject Stop races', async () => {
    const h = harness();
    h.resolver.resolveForActor.mockResolvedValueOnce(h.pool).mockResolvedValueOnce({ ...h.pool, entries: [] });
    await expect(h.service.resolve(parentId, request)).rejects.toThrow('Specialist grant');
    expect(h.work.registerExecution).not.toHaveBeenCalled();
    h.resolver.resolveForActor.mockResolvedValue(h.pool);
    h.work.registerExecution.mockRejectedValueOnce(new Error('conversation barrier'));
    await expect(h.service.resolve(parentId, request)).rejects.toThrow('barrier');
  });

  it('rejects spoofed branch identity before reading execution authority', async () => {
    const h = harness();
    await expect(h.service.resolve(parentId, { ...request, nativeCallBranch: 'unrelated' })).rejects.toThrow();
    expect(h.work.getExecution).not.toHaveBeenCalled();
  });

  it('preserves complete child output in the fenced completion payload', async () => {
    const h = harness();
    const child = { id: 'child', role: 'library_worker', parentExecutionId: parentId,
      resultPayload: { nativeState: { ...h.state, rootContext: { selected_agent_id: agentId } } } };
    h.work.getExecution.mockResolvedValue(child as any);
    const completeExecution = jest.fn().mockImplementation(async (_id, _status, result) => ({ resultPayload: result }));
    Object.assign(h.work, { completeExecution });
    const fullText = 'x'.repeat(9000);
    const result = await h.service.settle(parentId, 'child', { status: 'completed', text: fullText.slice(0, 8000), fullText });
    expect(result?.fullText).toBe(fullText);
    expect(result?.text).toHaveLength(8000);
    expect(completeExecution).toHaveBeenCalledTimes(1);
    await expect(h.service.settle(parentId, 'child', { status: 'completed', fullText: '😀'.repeat(65537) })).rejects.toThrow('durable result limit');
    expect(completeExecution).toHaveBeenCalledTimes(1);
  });

  it('isolates run-code output per child and mounts only selected worker documents', async () => {
    const h = harness();
    h.documents.findAllByWorkspace.mockResolvedValue({ documents: [{ id: 'own-document',
      filename: 'report.pdf', path: 'owner/own-workspace/report.pdf' }], pagination: { total: 1 } });
    const worker = { ...definition, tools: [{ name: 'run_code' }], agent_params: { params: {} as Record<string, string> },
      brain_context: [{ workspace_id: 'own-workspace', workspace_documents: [{ workspace_id: 'own-workspace',
        filepath: 'owner/own-workspace/report.pdf' }] }] };
    h.agents.buildGrpcAgentsForPlaybook.mockResolvedValue([worker as any]);
    const first = await h.service.resolve(parentId, request);
    const firstContext = JSON.parse(worker.agent_params.params['run_code_context_json']);
    expect(firstContext).toEqual({ userId: 'actor', runId: first.executionId, sources: [] });
    expect(h.shares.assertUserHasAccess).toHaveBeenCalledWith('actor', ['own-workspace']);
    expect(h.sources.buildSources).toHaveBeenCalledWith([], [{ workspaceId: 'own-workspace', path: 'owner/own-workspace/report.pdf' }]);
    const second = await h.service.resolve(parentId, { ...request, nativeCallId: 'other-call', nativeCallBranch: 'delegate_to_agent@other-call' });
    expect(JSON.parse(worker.agent_params.params['run_code_context_json']).runId).toBe(second.executionId);
    expect(second.executionId).not.toBe(first.executionId);
  });
});
