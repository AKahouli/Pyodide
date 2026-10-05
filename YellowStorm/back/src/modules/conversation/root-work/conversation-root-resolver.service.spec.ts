import { ConversationRootResolverService } from './conversation-root-resolver.service';
import { newRootExecutionPolicy } from '../../agent/interfaces/root-execution-policy.interface';

describe('ConversationRootResolverService', () => {
  const rootId = '507f1f77bcf86cd799439011';
  const workerId = '507f1f77bcf86cd799439012';
  const revisionId = '507f1f77bcf86cd799439013';
  function fixture() {
    const conversation = { createdBy: 'actor', rootAgentId: rootId, runtimeMode: 'governed', isArchived: false };
    const pool = { rootAgentId: rootId, rootSnapshotDigest: 'root-digest', delegationEnabled: true,
      defaultConfigurationMode: 'native', policy: newRootExecutionPolicy(),
      entries: [{ agentId: workerId, snapshotDigest: 'worker-digest' }], unavailableCounts: { agents: 0, teams: 0 } };
    const conversations = { getConversationDocument: jest.fn().mockResolvedValue(conversation),
      filterAccessibleWorkspaceIds: jest.fn().mockResolvedValue([]) };
    const ordinary = { resolveForActor: jest.fn().mockRejectedValue(new Error('not the owner')) };
    const governance = { resolveRuntime: jest.fn().mockResolvedValue({ revisionId, primaryAgentId: rootId,
      allowedAgentIds: [rootId, workerId], workspaceIds: ['approved'], rootWork: { version: 1, pool } }) };
    const agents = { findByIds: jest.fn().mockResolvedValue([{ _id: rootId }, { _id: workerId }]) };
    const snapshots = { computeDigest: jest.fn((agent: { _id: string }): string => agent._id === rootId ? 'root-digest' : 'worker-digest') };
    const service = new ConversationRootResolverService(conversations as never, ordinary as never, governance as never,
      agents as never, snapshots as never);
    return { service, conversations, ordinary, governance, agents, snapshots, pool, conversation };
  }

  it('executes a published non-owned Root through current governance proof; standard grants stay enforced', async () => {
    const f = fixture();
    await expect(f.service.resolveForActor(rootId, 'actor', 'conversation', revisionId)).resolves.toBe(f.pool);
    expect(f.ordinary.resolveForActor).not.toHaveBeenCalled();
    f.conversation.runtimeMode = 'standard';
    await expect(f.service.resolveForActor(rootId, 'actor', 'conversation')).rejects.toThrow('not the owner');
  });

  it('rejects changed revision, inactive or drifted profiles and revoked audience', async () => {
    const f = fixture();
    await expect(f.service.resolveForActor(rootId, 'actor', 'conversation', 'new-revision')).rejects.toThrow();
    f.agents.findByIds.mockResolvedValue([{ _id: rootId }]);
    await expect(f.service.resolveForActor(rootId, 'actor', 'conversation', revisionId)).rejects.toThrow();
    f.agents.findByIds.mockResolvedValue([{ _id: rootId }, { _id: workerId }]);
    f.snapshots.computeDigest.mockReturnValue('changed');
    await expect(f.service.resolveForActor(rootId, 'actor', 'conversation', revisionId)).rejects.toThrow();
    f.governance.resolveRuntime.mockRejectedValue(new Error('audience revoked'));
    await expect(f.service.resolveForActor(rootId, 'actor', 'conversation', revisionId)).rejects.toThrow('audience revoked');
  });

  it('intersects worker sources and document mounts without adding unrelated revision workspaces', async () => {
    const f = fixture();
    const definition = { id: workerId, brain_context: [
      { workspace_id: 'approved', workspace_documents: [{ workspace_id: 'approved' }, { workspace_id: 'outside' }] },
      { workspace_id: 'outside', workspace_documents: [] },
    ] };
    const result = await f.service.restrictDefinition('conversation', 'actor', definition as never);
    expect(result.brain_context).toEqual([{ workspace_id: 'approved', workspace_documents: [{ workspace_id: 'approved' }] }]);
    await expect(f.service.authorizedWorkspaces('conversation', 'actor', ['outside', 'approved'])).resolves.toEqual(['approved']);
    expect(f.conversations.filterAccessibleWorkspaceIds).not.toHaveBeenCalled();
  });
});
