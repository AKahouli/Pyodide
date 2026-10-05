import { GovernanceRootPublicationService } from './governance-root-publication.service';
import { newRootExecutionPolicy } from '@modules/agent/interfaces/root-execution-policy.interface';

describe('GovernanceRootPublicationService', () => {
  const rootId = '507f1f77bcf86cd799439011';
  const workerId = '507f1f77bcf86cd799439012';
  function fixture() {
    const root = { _id: rootId, isActive: true, agentTypeSlug: 'mono-agent', rootExecutionPolicy: newRootExecutionPolicy() };
    const agents = { findById: jest.fn().mockResolvedValue(root) };
    const pool = { rootAgentId: rootId, rootSnapshotDigest: 'frozen', delegationEnabled: true,
      defaultConfigurationMode: 'native', policy: root.rootExecutionPolicy, entries: [{ agentId: workerId }, { agentId: 'other' }],
      unavailableCounts: { agents: 0, teams: 0 } };
    const resolver = { resolveForActor: jest.fn().mockResolvedValue(pool) };
    const snapshots = { computeDigest: jest.fn().mockReturnValue('frozen') };
    const policies = { isEligibleRootType: jest.fn().mockReturnValue(true) };
    const revision = { id: 'revision', agentId: rootId, allowedAgentIds: [rootId, workerId] };
    const service = new GovernanceRootPublicationService(agents as never, resolver as never, snapshots as never, policies as never,
      { get: jest.fn().mockReturnValue('test-only-secret') } as never);
    return { service, agents, resolver, snapshots, root, revision, policies };
  }

  it('keeps a guide without Root policy direct and intersects an enrolled roster with approved agents', async () => {
    const f = fixture();
    const frozen = await f.service.capture('publisher', f.revision as never);
    expect(frozen?.pool.entries.map((entry) => entry.agentId)).toEqual([workerId]);
    f.agents.findById.mockResolvedValue({ ...f.root, rootExecutionPolicy: null } as never);
    await expect(f.service.capture('publisher', f.revision as never)).resolves.toBeUndefined();
  });

  it('fails closed for inactive profiles, invalid Root types, unauthorized publishers and publication drift', async () => {
    const f = fixture();
    const frozen = await f.service.capture('publisher', f.revision as never);
    f.snapshots.computeDigest.mockReturnValue('changed');
    await expect(f.service.assertUnchanged(frozen, f.revision as never, 'publisher')).rejects.toMatchObject({ code: 'ERR_3670' });
    f.policies.isEligibleRootType.mockReturnValue(false);
    await expect(f.service.capture('publisher', f.revision as never)).rejects.toMatchObject({ code: 'ERR_3670' });
    f.policies.isEligibleRootType.mockReturnValue(true);
    f.resolver.resolveForActor.mockRejectedValue(new Error('denied'));
    await expect(f.service.capture('publisher', f.revision as never)).rejects.toThrow('denied');
    f.agents.findById.mockResolvedValue({ ...f.root, isActive: false });
    await expect(f.service.capture('publisher', f.revision as never)).rejects.toMatchObject({ code: 'ERR_3670' });
  });
});
