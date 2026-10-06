import { ForbiddenException, NotFoundException } from '../../exceptions';
import { AgentRecord } from '../repositories/agent-record.mapper';
import { RootDelegateResolverService } from './root-delegate-resolver.service';

describe('RootDelegateResolverService', () => {
  const actorId = 'actor-1';
  const rootOwnerId = 'owner-1';

  const agentRepository = { findById: jest.fn(), findByIds: jest.fn() };
  const agentShareService = { getSharePermission: jest.fn() };
  const teamService = { findUserTeamById: jest.fn() };
  const rootPolicyService = { isEligibleRootType: (slug: string) => slug === 'mono-agent' };
  const snapshotService = { computeDigest: jest.fn().mockReturnValue('digest-1') };

  const resolver = new RootDelegateResolverService(
    agentRepository as never,
    agentShareService as never,
    rootPolicyService as never,
    snapshotService as never,
    teamService as never,
  );

  const worker = (id: string, over: Partial<AgentRecord> = {}): AgentRecord => ({
    _id: id, name: `agent-${id}`, slug: id, agentType: 'type-1', agentTypeSlug: 'specialist',
    role: '', description: '', temperature: 0, instruction: '', ignorePrePrompt: false,
    knowledgeBases: [], tools: [], skills: [], disabledSkills: [], connectors: [],
    connectorActionSelections: [], guardrails: {}, deploymentSettings: {},
    enable_temporary_child_agents: false, max_temporary_child_agents: 4,
    isDefault: false, isActive: true, isDefaultForType: false, createdBy: 'someone',
    a2aPublished: false, createdAt: new Date(), updatedAt: new Date(), ...over,
  });

  const root = (over: Partial<AgentRecord> = {}): AgentRecord => worker('root-1', {
    agentTypeSlug: 'mono-agent', createdBy: rootOwnerId, ...over,
  });

  beforeEach(() => jest.resetAllMocks());

  it('rejects non-owners reading an administrator root pool and missing agents', async () => {
    agentRepository.findById.mockResolvedValue(null);
    await expect(resolver.resolveForActor('missing', actorId)).rejects.toBeInstanceOf(NotFoundException);
    agentRepository.findById.mockResolvedValue(root({ createdBy: 'someone-else', _id: 'a'.repeat(24) }));
    await expect(resolver.resolveForActor('a'.repeat(24), actorId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(resolver.resolveForActor('not-an-id', actorId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deduplicates direct + team membership with merged provenance (A13)', async () => {
    agentRepository.findById.mockResolvedValue(root());
    agentRepository.findByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id: string) => worker(id, { createdBy: rootOwnerId })));
    teamService.findUserTeamById.mockResolvedValue({ members: [{ agentId: 'w1' }, { agentId: 'w2' }] });
    const pool = await resolver.resolveEffectivePool(
      root({ delegateAgentIds: ['w1'], delegateTeamIds: ['t1'] }), rootOwnerId);
    const w1 = pool.entries.find((e) => e.agentId === 'w1')!;
    expect(w1.source).toEqual({ direct: true, teamIds: ['t1'] });
    expect(pool.entries).toHaveLength(2);
  });

  it('excludes roots whose type slug uses the mono_agent spelling (A18)', async () => {
    agentRepository.findById.mockResolvedValue(root());
    agentRepository.findByIds.mockImplementation(async (ids: string[]) => ids.map((id) =>
      worker(id, { createdBy: rootOwnerId, agentTypeSlug: id === 'w-root2' ? 'mono_agent' : 'specialist' })));
    const pool = await resolver.resolveEffectivePool(
      root({ delegateAgentIds: ['w-root2', 'w-ok'] }), rootOwnerId);
    expect(pool.entries.map((e) => e.agentId)).toEqual(['w-ok']);
  });

  it('excludes other roots and humain agents from the pool (A18)', async () => {
    agentRepository.findById.mockResolvedValue(root());
    agentRepository.findByIds.mockImplementation(async (ids: string[]) => ids.map((id) =>
      worker(id, {
        createdBy: rootOwnerId,
        agentTypeSlug: id === 'w-root' ? 'mono-agent' : id === 'w-human' ? 'humain' : 'specialist',
      })));
    const pool = await resolver.resolveEffectivePool(
      root({ delegateAgentIds: ['w-root', 'w-human', 'w-ok'] }), rootOwnerId);
    expect(pool.entries.map((e) => e.agentId)).toEqual(['w-ok']);
    expect(pool.unavailableCounts.agents).toBe(2);
  });

  it('never expands an empty selection into all agents (A16) and counts unavailable teams', async () => {
    agentRepository.findById.mockResolvedValue(root());
    const pool = await resolver.resolveEffectivePool(root({ delegateTeamIds: ['gone'] }), rootOwnerId);
    expect(pool.entries).toEqual([]);
    expect(pool.unavailableCounts).toEqual({ agents: 0, teams: 1 });
    expect(agentRepository.findByIds).not.toHaveBeenCalled();
  });

  it('requires an explicit grant for a direct, non-owned, non-default agent (A19)', async () => {
    agentRepository.findById.mockResolvedValue(root({ createdBy: actorId }));
    agentRepository.findByIds.mockResolvedValue([worker('w-private', { createdBy: 'other' })]);
    agentShareService.getSharePermission.mockResolvedValue(null);
    const pool = await resolver.resolveEffectivePool(root({ delegateAgentIds: ['w-private'] }), actorId);
    expect(pool.entries).toEqual([]);
    expect(pool.unavailableCounts.agents).toBe(1);
    agentShareService.getSharePermission.mockResolvedValue('read');
    const pool2 = await resolver.resolveEffectivePool(root({ delegateAgentIds: ['w-private'] }), actorId);
    expect(pool2.entries).toHaveLength(1);
  });

  it('applies per-agent mode overrides over the default mode', async () => {
    agentRepository.findById.mockResolvedValue(root());
    agentRepository.findByIds.mockResolvedValue([
      worker('w1', { createdBy: rootOwnerId }), worker('w2', { createdBy: rootOwnerId }),
    ]);
    const policyRoot = root({
      createdBy: rootOwnerId,
      delegateAgentIds: ['w1', 'w2'],
      rootExecutionPolicy: {
        version: 1,
        delegation: { enabled: true, defaultConfigurationMode: 'native' },
        temporaryWorkers: { enabled: true, maxPerWorkGroup: 4 },
        fanout: { enabled: false, maxItems: 20, allowBackground: false },
        background: { enabled: false, maxOutstandingPerConversation: 2, taskTimeoutSeconds: 900, maxAttempts: 3 },
        limits: { maxDepth: 1, maxParallelWorkers: 2, maxChildExecutionsPerWorkGroup: 32, maxWorkGroupDurationSeconds: 1800 },
        perAgentModeOverrides: [{ agentId: 'w2', configurationMode: 'root_constrained' }],
      },
    });
    const pool = await resolver.resolveEffectivePool(policyRoot, rootOwnerId);
    expect(pool.entries.find((e) => e.agentId === 'w1')!.configurationMode).toBe('native');
    expect(pool.entries.find((e) => e.agentId === 'w2')!.configurationMode).toBe('root_constrained');
  });
});
