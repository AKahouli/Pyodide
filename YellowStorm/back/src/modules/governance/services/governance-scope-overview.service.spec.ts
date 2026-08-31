import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { GovernanceScopeOverviewService } from './governance-scope-overview.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceDeployment } from '../schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision } from '../schemas/governance-deployment-revision.schema';
import { GovernanceDocument } from '../schemas/governance-document.schema';
import { GovernanceDryRun } from '../schemas/governance-dry-run.schema';
import { GovernanceMembership } from '../schemas/governance-membership.schema';
import { GovernanceMetric } from '../schemas/governance-metric.schema';
import { GovernanceScope } from '../schemas/governance-scope.schema';
import { GovernanceWorkspaceBinding } from '../schemas/governance-workspace-binding.schema';
import { AgentRepository } from '@modules/agent/repositories/agent.repository';
import { User } from '@modules/user/schemas/user.schema';
import { WorkspaceDoc } from '@modules/workspace/schemas/workspace-document.schema';

const query = <T>(value: T) => ({
  sort: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

const checkKey = (check: { key: string }) => check.key;

describe('GovernanceScopeOverviewService', () => {
  const compileOverview = async (models: {
    scopeModel: object;
    documentModel?: object;
    workspaceDocumentModel?: object;
    workspaceBindingModel: object;
    deploymentModel: object;
    revisionModel: object;
    dryRunModel: object;
    membershipModel: object;
    metricModel: object;
    agentRepository: object;
  }) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        GovernanceScopeOverviewService,
        { provide: getModelToken(GovernanceScope.name), useValue: models.scopeModel },
        { provide: getModelToken(GovernanceDocument.name), useValue: models.documentModel ?? { find: jest.fn().mockReturnValue(query([])) } },
        { provide: getModelToken(WorkspaceDoc.name), useValue: models.workspaceDocumentModel ?? { find: jest.fn().mockReturnValue(query([])) } },
        { provide: getModelToken(GovernanceWorkspaceBinding.name), useValue: models.workspaceBindingModel },
        { provide: getModelToken(GovernanceDeployment.name), useValue: models.deploymentModel },
        { provide: getModelToken(GovernanceDeploymentRevision.name), useValue: models.revisionModel },
        { provide: getModelToken(GovernanceDryRun.name), useValue: models.dryRunModel },
        { provide: getModelToken(GovernanceMembership.name), useValue: models.membershipModel },
        { provide: getModelToken(GovernanceMetric.name), useValue: models.metricModel },
        { provide: AgentRepository, useValue: models.agentRepository },
        { provide: getModelToken(User.name), useValue: { find: jest.fn().mockReturnValue(query([])) } },
        { provide: GovernanceProgramService, useValue: { assertOwnedProgram: jest.fn().mockResolvedValue(undefined) } },
        { provide: GovernanceAccessService, useValue: { assertScopeAccess: jest.fn().mockResolvedValue(undefined), canActInScopeRole: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();
    return moduleRef.get(GovernanceScopeOverviewService);
  };

  it('aggregates scope readiness around agents, knowledge, deployment, and dry-run state', async () => {
    const programId = new Types.ObjectId();
    const scopeId = new Types.ObjectId();
    const deploymentId = new Types.ObjectId();
    const revisionId = new Types.ObjectId();
    const agentId = new Types.ObjectId();
    const specialistAgentId = new Types.ObjectId();
    const scopeModel = { findOne: jest.fn().mockReturnValue(query({ _id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [agentId, specialistAgentId], metadata: { guardrailsReviewedAt: '2026-07-17T12:00:00.000Z' }, createdAt: new Date(), updatedAt: new Date() })) };
    const sourceModel = { find: jest.fn().mockReturnValue(query([])) };
    const workspaceBindingModel = { find: jest.fn().mockReturnValue(query([{ _id: new Types.ObjectId(), programId, scopeIds: [scopeId], visibility: 'scope_specific', workspaceId: new Types.ObjectId(), enabled: true }])) };
    const deploymentModel = { findOne: jest.fn().mockReturnValue(query({ _id: deploymentId, programId, scopeId, name: 'Courbevoie public', status: 'dry_run', currentDraftRevisionId: revisionId, channels: {}, createdAt: new Date(), updatedAt: new Date() })) };
    const revisionModel = { findById: jest.fn().mockReturnValue(query({ _id: revisionId, deploymentId, revisionNumber: 1, status: 'draft', agentId, allowedAgentIds: [agentId, specialistAgentId], workspaceIds: [], sourceIds: [], includedSourceIds: [], excludedSourceIds: [], createdBy: agentId, createdAt: new Date(), updatedAt: new Date() })) };
    const dryRunModel = { findOne: jest.fn().mockReturnValue(query({ _id: new Types.ObjectId(), programId, scopeId, deploymentId, revisionId, testerId: agentId, status: 'passed', testCases: [], checks: {}, createdAt: new Date(), updatedAt: new Date() })) };
    const membershipModel = { find: jest.fn().mockReturnValue(query([{ _id: new Types.ObjectId(), programId, scopeId, role: 'scope_approver', status: 'active' }])) };
    const agentRepository = { findByIds: jest.fn().mockResolvedValue([agentId, specialistAgentId].map((_id) => ({ _id: _id.toString(), guardrails: { promptInjection: { inputEnabled: true, outputEnabled: false } } }))) };
    const metricModel = { find: jest.fn().mockReturnValue(query([{ type: 'usage', channel: 'widget', value: 3 }])) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        GovernanceScopeOverviewService,
        { provide: getModelToken(GovernanceScope.name), useValue: scopeModel },
        { provide: getModelToken(GovernanceDocument.name), useValue: sourceModel },
        { provide: getModelToken(WorkspaceDoc.name), useValue: { find: jest.fn().mockReturnValue(query([])) } },
        { provide: getModelToken(GovernanceWorkspaceBinding.name), useValue: workspaceBindingModel },
        { provide: getModelToken(GovernanceDeployment.name), useValue: deploymentModel },
        { provide: getModelToken(GovernanceDeploymentRevision.name), useValue: revisionModel },
        { provide: getModelToken(GovernanceDryRun.name), useValue: dryRunModel },
        { provide: getModelToken(GovernanceMembership.name), useValue: membershipModel },
        { provide: getModelToken(GovernanceMetric.name), useValue: metricModel },
        { provide: AgentRepository, useValue: agentRepository },
        { provide: getModelToken(User.name), useValue: { find: jest.fn().mockReturnValue(query([])) } },
        { provide: GovernanceProgramService, useValue: { assertOwnedProgram: jest.fn().mockResolvedValue(undefined) } },
        { provide: GovernanceAccessService, useValue: { assertScopeAccess: jest.fn().mockResolvedValue(undefined), canActInScopeRole: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();
    const service = moduleRef.get(GovernanceScopeOverviewService);

    const overview = await service.getOverview(agentId.toString(), programId.toString(), scopeId.toString());

    expect(overview.agents.mappedAgents).toHaveLength(2);
    expect(overview.draftRevision?.allowedAgentIds).toEqual([agentId.toString(), specialistAgentId.toString()]);
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
    expect(workspaceBindingModel.find).toHaveBeenCalledWith(expect.objectContaining({ programId, enabled: true, $or: [{ visibility: 'program_shared' }, { scopeIds: scopeId }] }));
  });

  it('ignores channel readiness when building scope blockers', async () => {
    const programId = new Types.ObjectId();
    const scopeId = new Types.ObjectId();
    const deploymentId = new Types.ObjectId();
    const revisionId = new Types.ObjectId();
    const agentId = new Types.ObjectId();
    const scopeModel = { findOne: jest.fn().mockReturnValue(query({ _id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [agentId], metadata: {}, createdAt: new Date(), updatedAt: new Date() })) };
    const sourceModel = { find: jest.fn().mockReturnValue(query([])) };
    const deploymentModel = { findOne: jest.fn().mockReturnValue(query({ _id: deploymentId, programId, scopeId, name: 'Courbevoie public', status: 'dry_run', currentDraftRevisionId: revisionId, channels: { [`${agentId.toString()}:widget`]: { enabled: true, status: 'ready' } }, createdAt: new Date(), updatedAt: new Date() })) };
    const revisionModel = { findById: jest.fn().mockReturnValue(query({ _id: revisionId, deploymentId, revisionNumber: 1, status: 'draft', agentId, workspaceIds: [], sourceIds: [], includedSourceIds: [], excludedSourceIds: [], createdBy: agentId, createdAt: new Date(), updatedAt: new Date() })) };
    const dryRunModel = { findOne: jest.fn().mockReturnValue(query({ _id: new Types.ObjectId(), programId, scopeId, deploymentId, revisionId, testerId: agentId, status: 'passed', testCases: [], checks: {}, createdAt: new Date(), updatedAt: new Date() })) };
    const membershipModel = { find: jest.fn().mockReturnValue(query([])) };
    const agentRepository = { findByIds: jest.fn().mockResolvedValue([]) };
    const metricModel = { find: jest.fn().mockReturnValue(query([])) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        GovernanceScopeOverviewService,
        { provide: getModelToken(GovernanceScope.name), useValue: scopeModel },
        { provide: getModelToken(GovernanceDocument.name), useValue: sourceModel },
        { provide: getModelToken(WorkspaceDoc.name), useValue: { find: jest.fn().mockReturnValue(query([])) } },
        { provide: getModelToken(GovernanceWorkspaceBinding.name), useValue: { find: jest.fn().mockReturnValue(query([])) } },
        { provide: getModelToken(GovernanceDeployment.name), useValue: deploymentModel },
        { provide: getModelToken(GovernanceDeploymentRevision.name), useValue: revisionModel },
        { provide: getModelToken(GovernanceDryRun.name), useValue: dryRunModel },
        { provide: getModelToken(GovernanceMembership.name), useValue: membershipModel },
        { provide: getModelToken(GovernanceMetric.name), useValue: metricModel },
        { provide: AgentRepository, useValue: agentRepository },
        { provide: getModelToken(User.name), useValue: { find: jest.fn().mockReturnValue(query([])) } },
        { provide: GovernanceProgramService, useValue: { assertOwnedProgram: jest.fn().mockResolvedValue(undefined) } },
        { provide: GovernanceAccessService, useValue: { assertScopeAccess: jest.fn().mockResolvedValue(undefined), canActInScopeRole: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();
    const service = moduleRef.get(GovernanceScopeOverviewService);

    const overview = await service.getOverview(agentId.toString(), programId.toString(), scopeId.toString());

    expect(overview.readiness.blockers.map(checkKey)).not.toContain(`channel_${agentId.toString()}:widget_ready`);
    expect(overview.readiness.blockers.map(checkKey)).toContain('ownership_assigned');
  });

  it.each(['suspended', 'archived'])('does not surface %s deployment state as a scope blocker', async (status) => {
    const programId = new Types.ObjectId();
    const scopeId = new Types.ObjectId();
    const deploymentId = new Types.ObjectId();
    const revisionId = new Types.ObjectId();
    const agentId = new Types.ObjectId();
    const workspaceId = new Types.ObjectId();
    const scopeModel = { findOne: jest.fn().mockReturnValue(query({ _id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [agentId], metadata: {}, createdAt: new Date(), updatedAt: new Date() })) };
    const sourceModel = { find: jest.fn().mockReturnValue(query([])) };
    const deploymentModel = { findOne: jest.fn().mockReturnValue(query({ _id: deploymentId, programId, scopeId, name: 'Courbevoie public', status, currentDraftRevisionId: revisionId, currentPublishedRevisionId: revisionId, channels: {}, createdAt: new Date(), updatedAt: new Date() })) };
    const revisionModel = { findById: jest.fn().mockReturnValue(query({ _id: revisionId, deploymentId, revisionNumber: 1, status: 'published', agentId, workspaceIds: [], sourceIds: [], includedSourceIds: [], excludedSourceIds: [], createdBy: agentId, createdAt: new Date(), updatedAt: new Date() })) };
    const dryRunModel = { findOne: jest.fn().mockReturnValue(query({ _id: new Types.ObjectId(), programId, scopeId, deploymentId, revisionId, testerId: agentId, status: 'passed', testCases: [], checks: {}, createdAt: new Date(), updatedAt: new Date() })) };
    const membershipModel = { find: jest.fn().mockReturnValue(query([])) };
    const agentRepository = { findByIds: jest.fn().mockResolvedValue([]) };
    const metricModel = { find: jest.fn().mockReturnValue(query([])) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        GovernanceScopeOverviewService,
        { provide: getModelToken(GovernanceScope.name), useValue: scopeModel },
        { provide: getModelToken(GovernanceDocument.name), useValue: sourceModel },
        { provide: getModelToken(WorkspaceDoc.name), useValue: { find: jest.fn().mockReturnValue(query([])) } },
        { provide: getModelToken(GovernanceWorkspaceBinding.name), useValue: { find: jest.fn().mockReturnValue(query([{ _id: new Types.ObjectId(), programId, workspaceId, visibility: 'scope_specific', scopeIds: [scopeId], enabled: true }])) } },
        { provide: getModelToken(GovernanceDeployment.name), useValue: deploymentModel },
        { provide: getModelToken(GovernanceDeploymentRevision.name), useValue: revisionModel },
        { provide: getModelToken(GovernanceDryRun.name), useValue: dryRunModel },
        { provide: getModelToken(GovernanceMembership.name), useValue: membershipModel },
        { provide: getModelToken(GovernanceMetric.name), useValue: metricModel },
        { provide: AgentRepository, useValue: agentRepository },
        { provide: getModelToken(User.name), useValue: { find: jest.fn().mockReturnValue(query([])) } },
        { provide: GovernanceProgramService, useValue: { assertOwnedProgram: jest.fn().mockResolvedValue(undefined) } },
        { provide: GovernanceAccessService, useValue: { assertScopeAccess: jest.fn().mockResolvedValue(undefined), canActInScopeRole: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    const result = await moduleRef.get(GovernanceScopeOverviewService).getOverview(new Types.ObjectId().toString(), programId.toString(), scopeId.toString());

    expect(result.knowledge.sharedWorkspaces).toEqual([]);
    expect(result.knowledge.localWorkspaces).toHaveLength(1);
    expect(result.knowledge.documents).toEqual([]);
    expect(result.readiness.checks).toContainEqual(expect.objectContaining({ key: 'knowledge_mapped', status: 'passed', targetType: 'workspace' }));
  });
});
