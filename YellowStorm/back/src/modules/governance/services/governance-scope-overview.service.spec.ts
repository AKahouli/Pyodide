import { Types } from 'mongoose';
import { GovernanceScopeOverviewService } from './governance-scope-overview.service';

const checkKey = (check: { key: string }) => check.key;

describe('GovernanceScopeOverviewService', () => {
  const buildService = (stores: {
    scope?: Record<string, unknown>;
    bindings?: Record<string, unknown>[];
    bindingStore?: { listEnabled: jest.Mock };
    deployment?: Record<string, unknown> | null;
    revision?: Record<string, unknown> | null;
    revisionStore?: object;
    dryRun?: Record<string, unknown> | null;
    memberships?: Record<string, unknown>[];
    metrics?: Record<string, unknown>[];
    agents?: unknown[];
  }) => {
    const scopeStore = { findByProgramAndId: jest.fn().mockResolvedValue(stores.scope), listByProgram: jest.fn().mockResolvedValue([]) };
    const documentStore = { listForProgramWorkspaces: jest.fn().mockResolvedValue([]) };
    const bindingStore = stores.bindingStore ?? {
      listEnabled: jest.fn().mockResolvedValue(stores.bindings ?? []),
    };
    const deploymentStore = { findByProgramAndScope: jest.fn().mockResolvedValue(stores.deployment) };
    const resolvedRevisionStore = stores.revisionStore ?? { findById: jest.fn().mockResolvedValue(stores.revision), listByIds: jest.fn().mockResolvedValue([]) };
    const dryRunStore = { findLatestByDeployment: jest.fn().mockResolvedValue(stores.dryRun) };
    const membershipStore = { listByProgram: jest.fn().mockResolvedValue(stores.memberships ?? []) };
    const metricStore = { listByProgramAndScope: jest.fn().mockResolvedValue(stores.metrics ?? []) };
    const agentRepository = { findByIds: jest.fn().mockResolvedValue(stores.agents ?? []) };
    const userLookup = { byId: jest.fn(), byIds: jest.fn().mockResolvedValue(new Map()) };
    const programService = { assertOwnedProgram: jest.fn().mockResolvedValue(undefined) };
    const accessService = { assertScopeAccess: jest.fn().mockResolvedValue(undefined), canActInScopeRole: jest.fn().mockResolvedValue(true) };
    const service = new GovernanceScopeOverviewService(
      scopeStore as never,
      documentStore as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      bindingStore as never,
      deploymentStore as never,
      resolvedRevisionStore as never,
      dryRunStore as never,
      membershipStore as never,
      metricStore as never,
      agentRepository as never,
      userLookup as never,
      programService as never,
      accessService as never,
    );
    return { service, bindingStore, agentRepository };
  };

  it('aggregates scope readiness around agents, knowledge, deployment, and dry-run state', async () => {
    const programId = new Types.ObjectId().toString();
    const scopeId = new Types.ObjectId().toString();
    const deploymentId = new Types.ObjectId().toString();
    const revisionId = new Types.ObjectId().toString();
    const agentId = new Types.ObjectId().toString();
    const specialistAgentId = new Types.ObjectId().toString();
    const revision = { id: revisionId, deploymentId, revisionNumber: 1, status: 'draft', agentId, allowedAgentIds: [agentId, specialistAgentId], workspaceIds: [], createdBy: agentId };
    const { service, bindingStore } = buildService({
      scope: { id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [agentId, specialistAgentId], metadata: {}, audience: { mode: 'restricted', userIds: [], groupIds: [] }, knowledge: { sourceMode: 'llm_only', webSourcesEnabled: false, webAllowedDomains: [], webBlockedDomains: [] } },
      bindings: [{ id: new Types.ObjectId().toString(), programId, scopeIds: [scopeId], visibility: 'scope_specific', workspaceId: new Types.ObjectId().toString(), enabled: true }],
      deployment: { id: deploymentId, programId, scopeId, name: 'Courbevoie public', status: 'dry_run', currentDraftRevisionId: revisionId, channels: {} },
      revision,
      dryRun: { id: new Types.ObjectId().toString(), deploymentId, revisionId, testerId: agentId, status: 'passed', testCases: [], checks: {} },
      memberships: [{ id: new Types.ObjectId().toString(), programId, scopeId, role: 'scope_approver', status: 'active' }],
      agents: [agentId, specialistAgentId].map((id) => ({ _id: id, guardrails: { promptInjection: { inputEnabled: true, outputEnabled: false } } })),
      metrics: [{ type: 'usage', channel: 'widget', value: 3 }],
    });

    const overview = await service.getOverview(agentId, programId, scopeId);

    expect(overview.agents.mappedAgents).toHaveLength(2);
    expect(overview.draftRevision?.allowedAgentIds).toEqual([agentId, specialistAgentId]);
    expect(overview.knowledge.localWorkspaces).toHaveLength(1);
    expect(overview.readiness.blockers).toHaveLength(0);
    expect(overview.readiness.checks.map(checkKey)).toEqual(expect.arrayContaining(['ownership_assigned', 'guardrails_reviewed']));
    expect(overview.readiness.checks.map(checkKey).slice(0, 10)).toEqual([
      'scope_active',
      'agents_mapped',
      'knowledge_mapped',
      'ownership_assigned',
      'guardrails_reviewed',
      'draft_revision',
      'dry_run_passed',
      'audience_configured',
      'published_agent_roster_valid',
      'published_workspace_set_valid',
    ]);
    expect(overview.metricsSummary.byChannel.widget).toBe(3);
    expect(overview.readiness.checks.find((check) => checkKey(check) === 'knowledge_mapped')).toEqual(expect.objectContaining({ status: 'passed', targetType: 'workspace' }));
    expect(overview.readiness.checks.find((check) => checkKey(check) === 'guardrails_reviewed')?.status).toBe('passed');
    expect(overview.readiness.checks.find((check) => checkKey(check) === 'published_agent_roster_valid')?.status).toBe('passed');
    expect(overview.readiness.checks.find((check) => checkKey(check) === 'published_workspace_set_valid')?.status).toBe('passed');
    expect((bindingStore.listEnabled as jest.Mock)).toHaveBeenCalledWith(programId, [scopeId]);
  });

  it('ignores channel readiness when building scope blockers', async () => {
    const programId = new Types.ObjectId().toString();
    const scopeId = new Types.ObjectId().toString();
    const deploymentId = new Types.ObjectId().toString();
    const revisionId = new Types.ObjectId().toString();
    const agentId = new Types.ObjectId().toString();
    const { service } = buildService({
      scope: { id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [agentId], metadata: {}, audience: { mode: 'restricted', userIds: [], groupIds: [] }, knowledge: { sourceMode: 'llm_only', webSourcesEnabled: false, webAllowedDomains: [], webBlockedDomains: [] } },
      deployment: { id: deploymentId, programId, scopeId, name: 'Courbevoie public', status: 'dry_run', currentDraftRevisionId: revisionId, channels: { [`${agentId}:widget`]: { enabled: true, status: 'ready' } } },
      revision: { id: revisionId, deploymentId, revisionNumber: 1, status: 'draft', agentId, workspaceIds: [], createdBy: agentId },
      dryRun: { id: new Types.ObjectId().toString(), deploymentId, revisionId, testerId: agentId, status: 'passed', testCases: [], checks: {} },
    });

    const overview = await service.getOverview(agentId, programId, scopeId);

    expect(overview.readiness.blockers.map(checkKey)).not.toContain(`channel_${agentId}:widget_ready`);
    expect(overview.readiness.blockers.map(checkKey)).toContain('ownership_assigned');
  });

  it.each(['suspended', 'archived'])('does not surface %s deployment state as a scope blocker', async (status) => {
    const programId = new Types.ObjectId().toString();
    const scopeId = new Types.ObjectId().toString();
    const deploymentId = new Types.ObjectId().toString();
    const revisionId = new Types.ObjectId().toString();
    const agentId = new Types.ObjectId().toString();
    const workspaceId = new Types.ObjectId().toString();
    const { service } = buildService({
      scope: { id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [agentId], metadata: {}, audience: { mode: 'restricted', userIds: [], groupIds: [] }, knowledge: { sourceMode: 'llm_only', webSourcesEnabled: false, webAllowedDomains: [], webBlockedDomains: [] } },
      bindings: [{ id: new Types.ObjectId().toString(), programId, workspaceId, visibility: 'scope_specific', scopeIds: [scopeId], enabled: true }],
      deployment: { id: deploymentId, programId, scopeId, name: 'Courbevoie public', status, currentDraftRevisionId: revisionId, currentPublishedRevisionId: revisionId, channels: {} },
      revision: { id: revisionId, deploymentId, revisionNumber: 1, status: 'published', agentId, workspaceIds: [], createdBy: agentId },
      dryRun: { id: new Types.ObjectId().toString(), deploymentId, revisionId, testerId: agentId, status: 'passed', testCases: [], checks: {} },
    });

    const result = await service.getOverview(new Types.ObjectId().toString(), programId, scopeId);

    expect(result.knowledge.sharedWorkspaces).toEqual([]);
    expect(result.knowledge.localWorkspaces).toHaveLength(1);
    expect(result.knowledge.documents).toEqual([]);
    expect(result.readiness.checks).toContainEqual(expect.objectContaining({ key: 'knowledge_mapped', status: 'passed', targetType: 'workspace' }));
  });

  it.each([
    { knowledge: { sourceMode: 'workspaces_only', webSourcesEnabled: true, webAllowedDomains: ['docs.example.com'], webBlockedDomains: ['tracker.example.net'] }, expected: { sourceMode: 'workspaces_only', webSourcesEnabled: true, webAllowedDomains: ['docs.example.com'], webBlockedDomains: ['tracker.example.net'] } },
    { knowledge: undefined, expected: { sourceMode: 'llm_only', webSourcesEnabled: false, webAllowedDomains: [], webBlockedDomains: [] } },
  ])('surfaces scope knowledge settings on the overview ($_)', async ({ knowledge, expected }) => {
    const programId = new Types.ObjectId().toString();
    const scopeId = new Types.ObjectId().toString();
    const agentId = new Types.ObjectId().toString();
    const { service } = buildService({
      scope: { id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [agentId], metadata: {}, ...(knowledge ? { knowledge } : {}), audience: { mode: 'restricted', userIds: [], groupIds: [] } },
      deployment: { id: new Types.ObjectId().toString(), programId, scopeId, name: 'Courbevoie public', status: 'draft', currentDraftRevisionId: new Types.ObjectId().toString(), channels: {} },
      revision: { id: new Types.ObjectId().toString(), revisionNumber: 1, status: 'draft', agentId, workspaceIds: [], createdBy: agentId },
    });

    const result = await service.getOverview(agentId, programId, scopeId);

    expect(result.scope.knowledge).toEqual(expected);
  });

  it.each([
    { knowledge: { sourceMode: 'llm_only' }, expectedStatus: 'passed' },
    { knowledge: { sourceMode: 'workspaces_only' }, expectedStatus: 'failed' },
    { knowledge: undefined, expectedStatus: 'failed' },
  ])('gates the knowledge readiness check on the scope source mode ($_)', async ({ knowledge, expectedStatus }) => {
    const programId = new Types.ObjectId().toString();
    const scopeId = new Types.ObjectId().toString();
    const { service } = buildService({
      scope: { id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [], metadata: {}, audience: { mode: 'restricted', userIds: [], groupIds: [] }, ...(knowledge ? { knowledge: { ...knowledge, webSourcesEnabled: false, webAllowedDomains: [], webBlockedDomains: [] } } : {}) },
    });

    const result = await service.getOverview(new Types.ObjectId().toString(), programId, scopeId);

    const knowledgeCheck = result.readiness.checks.find((check) => checkKey(check) === 'knowledge_mapped');
    expect(knowledgeCheck?.status).toBe(expectedStatus);
  });
});
