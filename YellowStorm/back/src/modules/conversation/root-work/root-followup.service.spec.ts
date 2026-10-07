import { RootFollowupService } from './root-followup.service';

describe('Current-authority synthesis-only follow-up', () => {
  function fixture() {
    const state = { actorId: 'owner', schedulingSeal: { digest: 'manifest', resultManifest: [
      { executionId: 'completed-child' }, { executionId: 'failed-child' }], followupExecutionId: 'followup' },
      scope: { immutableSnapshotRef: 'pinned' } };
    const root = { id: 'root', rootAgentId: 'agent', conversationId: 'conversation', role: 'root',
      status: 'completed', conversationEpoch: 4, resultPayload: { nativeState: state } };
    const childState = { actorId: 'owner', followup: { manifestDigest: 'manifest', publicationMessageId: 'message' },
      admittedRequest: { task: 'Immutable terminal results' }, rootContext: { root_agent_id: 'agent' },
      scope: { role: 'followup', executionId: 'followup', parentExecutionId: 'root', depth: 0, conversationEpoch: 4 } };
    const followup = { id: 'followup', parentExecutionId: 'root', conversationId: 'conversation',
      resultPayload: { nativeState: childState } };
    const job = { actorId: 'owner', requestDigest: 'request', nativeSessionId: 'session', fence: 2,
      nativeInvocationId: 'native', initialInputEventId: 'initial', deadline: new Date(Date.now() + 60000) };
    const store = { candidates: jest.fn().mockResolvedValue([]), completed: jest.fn().mockResolvedValue([]),
      reserve: jest.fn(), publish: jest.fn(), readResult: jest.fn().mockResolvedValue({ text: 'Bounded result' }),
      owned: jest.fn().mockResolvedValue({ root, state: childState, execution: followup, job }) };
    const work = { getExecution: jest.fn(async (id: string) => id === 'root' ? root : followup),
      completeExecution: jest.fn().mockResolvedValue({ resultPayload: {} }) };
    const results = { authorizeSynthesisMember: jest.fn().mockResolvedValue({}),
      authorizeBackgroundExecution: jest.fn().mockResolvedValue(followup) };
    const conversation = { createdBy: 'owner', rootAgentId: 'agent', rootWorkEpoch: 4 };
    const conversations = { getConversationDocument: jest.fn().mockResolvedValue(conversation) };
    const pool = { policy: { background: { enabled: true } }, rootSnapshotDigest: 'pinned' };
    const resolver = { resolveForActor: jest.fn().mockResolvedValue(pool) };
    const definition = { id: 'agent', name: 'Root', prompt: 'Pinned', tools: [{ name: 'send' }],
      brain_context: [{ private: 'source' }], skills: [{ name: 'effect' }], save_memory: true };
    const agents = { buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([definition]) };
    const service = new RootFollowupService(store as never, work as never, results as never,
      conversations as never, resolver as never, agents as never);
    const authority = { owner: 'replica', fence: 2, nativeOwner: 'native-owner', requestDigest: 'request' };
    return { service, authority, store, work, results, conversation, pool, agents, definition, job };
  }

  it('hydrates the pinned Root profile with no tools, sources, skills or memory effects', async () => {
    const h = fixture(); const resolved = await h.service.definition('followup', h.authority);
    expect(resolved.definition).toMatchObject({ tools: [], brain_context: [], skills: [], save_memory: false });
    expect(h.definition.tools).toHaveLength(1);
    expect(h.results.authorizeSynthesisMember).toHaveBeenCalledWith('conversation', 'failed-child', 'owner');
    expect(h.store.owned).toHaveBeenCalledTimes(2);
  });
  it('blocks profile hydration after pinned revision, actor, epoch or background permission changes', async () => {
    for (const change of ['revision', 'actor', 'epoch', 'policy']) {
      const h = fixture();
      if (change === 'revision') h.pool.rootSnapshotDigest = 'changed';
      if (change === 'actor') h.conversation.createdBy = 'other';
      if (change === 'epoch') h.conversation.rootWorkEpoch = 5;
      if (change === 'policy') h.pool.policy.background.enabled = false;
      await expect(h.service.definition('followup', h.authority)).rejects.toThrow('authority');
      expect(h.agents.buildGrpcAgentsForPlaybook).not.toHaveBeenCalled();
    }
  });
  it('rechecks authority after asynchronous profile hydration', async () => {
    const h = fixture();
    h.agents.buildGrpcAgentsForPlaybook.mockImplementationOnce(async () => {
      h.pool.policy.background.enabled = false; return [h.definition];
    });
    await expect(h.service.definition('followup', h.authority)).rejects.toThrow('authority');
    expect(h.store.owned).toHaveBeenCalledTimes(1);
  });
  it('requires native correlation and forbids new approval or evidence during synthesis settlement', async () => {
    const h = fixture(); const request = { ...h.authority, status: 'completed' as const, fullText: 'Synthesis' };
    h.job.nativeInvocationId = '';
    await expect(h.service.settle('followup', request)).rejects.toThrow('correlation');
    h.job.nativeInvocationId = 'native';
    await expect(h.service.settle('followup', { ...request, status: 'waiting' })).rejects.toThrow('approvals');
    await expect(h.service.settle('followup', { ...request, evidence: [{}] as never })).rejects.toThrow('evidence');
    expect(h.work.completeExecution).not.toHaveBeenCalled();
  });
  it('returns a bounded result only after current resource and native ownership rechecks', async () => {
    const h = fixture();
    expect(await h.service.readResult('followup', 'completed-child', { ...h.authority, offset: 8000 }))
      .toEqual({ text: 'Bounded result' });
    expect(h.store.readResult).toHaveBeenCalledWith(expect.objectContaining({ executionId: 'followup' }), 'completed-child', 8000);
    expect(h.store.owned).toHaveBeenCalledTimes(2);
    h.store.readResult.mockImplementationOnce(async () => {
      h.pool.policy.background.enabled = false; return { text: 'Must not escape' };
    });
    await expect(h.service.readResult('followup', 'completed-child', h.authority)).rejects.toThrow('authority');
  });
  it('rejects a result if native ownership changes during authorization', async () => {
    const h = fixture();
    h.store.owned.mockResolvedValueOnce(await h.store.owned()).mockRejectedValueOnce(new Error('Ownership changed'));
    await expect(h.service.readResult('followup', 'completed-child', h.authority)).rejects.toThrow('Ownership changed');
  });
  it('reconciles reserved and completed work through current authority without another model dispatch', async () => {
    const h = fixture();
    h.store.candidates.mockResolvedValueOnce([{ id: 'root' }] as never);
    h.store.completed.mockResolvedValueOnce([{ id: 'followup', conversationId: 'conversation' }] as never);
    await h.service.reconcile();
    expect(h.store.reserve).toHaveBeenCalledWith('root', 'owner', 'manifest');
    expect(h.store.publish).toHaveBeenCalledWith('followup', 'owner', 'manifest');
    expect(h.agents.buildGrpcAgentsForPlaybook).not.toHaveBeenCalled();
    await h.service.reconcile();
    expect(h.store.candidates).toHaveBeenLastCalledWith('root');
    expect(h.store.completed).toHaveBeenLastCalledWith('followup');
  });
});
