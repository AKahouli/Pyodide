import { RootResultService } from './root-result.service';

describe('Root child full output retrieval', () => {
  const conversation = { createdBy: 'owner', rootAgentId: 'root', rootWorkEpoch: 4 };
  const parent = { id: 'parent', conversationId: 'conversation', resultPayload: {
    nativeState: { scope: { immutableSnapshotRef: 'root-snapshot' } } } };
  const execution = { id: 'child', parentExecutionId: 'parent', conversationId: 'conversation', rootAgentId: 'root',
    conversationEpoch: 4, role: 'library_worker', status: 'completed',
    resultPayload: { text: 'summary', fullText: 'x'.repeat(9000),
      nativeState: { actorId: 'owner', private: true, rootContext: { selected_agent_id: 'worker', source_workspace_ids: [] },
        scope: { immutableSnapshotRef: 'snapshot' } }, citationRefs: ['private-source'] } };
  function setup(conversationPatch = {}, executionPatch = {}) {
    return new RootResultService({ getConversationDocument: jest.fn().mockResolvedValue({ ...conversation, ...conversationPatch }),
      filterAccessibleWorkspaceIds: jest.fn().mockResolvedValue([]) } as never,
      { getExecution: jest.fn().mockImplementation(async (id) => id === 'parent' ? parent : { ...execution, ...executionPatch }) } as never,
      { resolveForActor: jest.fn().mockResolvedValue({ delegationEnabled: true,
        rootSnapshotDigest: 'root-snapshot', entries: [{ agentId: 'worker', snapshotDigest: 'snapshot' }] }) } as never);
  }
  it('returns full text without native state or unverified evidence references', async () => {
    expect(await setup().getResult('conversation', 'child', 'owner')).toEqual({
      executionId: 'child', text: execution.resultPayload.fullText, complete: true });
  });
  it.each(['member', 'guest', 'other-owner'])('denies %s', async (actor) => {
    await expect(setup().getResult('conversation', 'child', actor)).rejects.toThrow('unavailable');
  });
  it('denies stale Stop epoch, binding, conversation and execution actors', async () => {
    for (const patch of [{ conversationEpoch: 3 }, { rootAgentId: 'other' },
      { conversationId: 'other' }, { status: 'waiting' }, { role: 'root' },
      { resultPayload: { ...execution.resultPayload, nativeState: { actorId: 'other' } } }]) {
      await expect(setup({}, patch).getResult('conversation', 'child', 'owner')).rejects.toThrow('unavailable');
    }
    await expect(setup({ isArchived: true }).getResult('conversation', 'child', 'owner')).rejects.toThrow('unavailable');
  });
  it('marks legacy clipped results as incomplete', async () => {
    expect(await setup({}, { resultPayload: { text: 'old summary', nativeState: execution.resultPayload.nativeState } })
      .getResult('conversation', 'child', 'owner')).toEqual({ executionId: 'child', text: 'old summary', complete: false });
  });
  it('denies revoked delegate grants and changed worker definitions', async () => {
    for (const pool of [{ delegationEnabled: false, entries: [] },
      { delegationEnabled: true, entries: [] },
      { delegationEnabled: true, entries: [{ agentId: 'worker', snapshotDigest: 'changed' }] }]) {
      const service = new RootResultService({ getConversationDocument: jest.fn().mockResolvedValue(conversation),
        filterAccessibleWorkspaceIds: jest.fn().mockResolvedValue([]) } as never,
        { getExecution: jest.fn().mockResolvedValue(execution) } as never,
        { resolveForActor: jest.fn().mockResolvedValue(pool) } as never);
      await expect(service.getResult('conversation', 'child', 'owner')).rejects.toThrow('unavailable');
    }
  });
  it('denies full output when a frozen source workspace loses read access', async () => {
    const revoked = { ...execution.resultPayload, nativeState: { ...execution.resultPayload.nativeState,
      rootContext: { selected_agent_id: 'worker', source_workspace_ids: ['revoked-workspace'] } } };
    await expect(setup({}, { resultPayload: revoked }).getResult('conversation', 'child', 'owner')).rejects.toThrow('source access');
  });
  it('denies summary-only legacy results without positive frozen source proof', async () => {
    const legacy = { text: 'private source summary', nativeState: { ...execution.resultPayload.nativeState,
      rootContext: { selected_agent_id: 'worker' } } };
    await expect(setup({}, { resultPayload: legacy }).getResult('conversation', 'child', 'owner')).rejects.toThrow('source permissions');
  });
  it('authorizes temporary results against their origin ROOT without requiring a library pool grant', async () => {
    const temporary = { ...execution, role: 'temporary_worker', resultPayload: { ...execution.resultPayload,
      nativeState: { ...execution.resultPayload.nativeState, scope: { immutableSnapshotRef: 'root-snapshot' },
        rootContext: { selected_agent_id: 'child', origin_root_agent_id: 'root', source_workspace_ids: [] } } } };
    const pool = { delegationEnabled: false, entries: [], rootSnapshotDigest: 'root-snapshot',
      policy: { temporaryWorkers: { enabled: true } } };
    const service = new RootResultService({ getConversationDocument: jest.fn().mockResolvedValue(conversation),
      filterAccessibleWorkspaceIds: jest.fn().mockResolvedValue([]) } as never,
      { getExecution: jest.fn().mockImplementation(async (id) => id === 'parent' ? parent : temporary) } as never,
      { resolveForActor: jest.fn().mockResolvedValue(pool) } as never);
    expect((await service.getResult('conversation', 'child', 'owner')).complete).toBe(true);
    pool.policy.temporaryWorkers.enabled = false;
    await expect(service.getResult('conversation', 'child', 'owner')).rejects.toThrow('unavailable');
  });
});
