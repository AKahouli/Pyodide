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
    const workspaceId = new Types.ObjectId();
    const documentId = new Types.ObjectId();
    const governanceDocumentId = new Types.ObjectId();
    const workspaceBindingModel = { find: jest.fn().mockReturnValue(query([{ _id: new Types.ObjectId(), programId, scopeIds: [scopeId], visibility: 'scope_specific', workspaceId, enabled: true }])) };
    const service = await compileOverview({
      scopeModel: { findOne: jest.fn().mockReturnValue(query({ _id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [agentId, specialistAgentId], metadata: { guardrailsReviewedAt: '2026-07-17T12:00:00.000Z' }, createdAt: new Date(), updatedAt: new Date() })) },
      documentModel: { find: jest.fn().mockReturnValue(query([{ _id: governanceDocumentId, programId, documentId, workspaceId, status: 'approved', tags: [], metadata: {}, updatedAt: new Date() }])) },
      workspaceDocumentModel: { find: jest.fn().mockReturnValue(query([{ _id: documentId, originalName: 'City charter', mimeType: 'application/pdf', type: 'doc', status: 'completed', indexingStatus: 'ready', updatedAt: new Date() }])) },
      workspaceBindingModel,
      deploymentModel: { findOne: jest.fn().mockReturnValue(query({ _id: deploymentId, programId, scopeId, name: 'Courbevoie public', status: 'dry_run', currentDraftRevisionId: revisionId, channels: {}, createdAt: new Date(), updatedAt: new Date() })) },
      revisionModel: { findById: jest.fn().mockReturnValue(query({ _id: revisionId, deploymentId, revisionNumber: 1, status: 'draft', agentId, allowedAgentIds: [agentId, specialistAgentId], workspaceIds: [], sourceIds: [], includedSourceIds: [], excludedSourceIds: [], createdBy: agentId, createdAt: new Date(), updatedAt: new Date() })) },
      dryRunModel: { findOne: jest.fn().mockReturnValue(query({ _id: new Types.ObjectId(), programId, scopeId, deploymentId, revisionId, testerId: agentId, status: 'passed', testCases: [], checks: {}, createdAt: new Date(), updatedAt: new Date() })) },
      membershipModel: { find: jest.fn().mockReturnValue(query([{ _id: new Types.ObjectId(), programId, scopeId, role: 'scope_approver', status: 'active' }])) },
      agentRepository: { findByIds: jest.fn().mockResolvedValue([agentId, specialistAgentId].map((_id) => ({ _id: _id.toString(), guardrails: { promptInjection: { inputEnabled: true, outputEnabled: false }, toolActionReview: { enabled: false } } }))) },
      metricModel: { find: jest.fn().mockReturnValue(query([{ type: 'usage', channel: 'widget', value: 3 }])) },
    });

    const overview = await service.getOverview(agentId.toString(), programId.toString(), scopeId.toString());

    expect(overview.agents.mappedAgents).toHaveLength(2);
    expect(overview.draftRevision?.allowedAgentIds).toEqual([agentId.toString(), specialistAgentId.toString()]);
    expect(overview.knowledge.sharedWorkspaces).toHaveLength(0);
    expect(overview.knowledge.localWorkspaces).toHaveLength(1);
    expect(overview.knowledge.documents).toHaveLength(1);
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
    expect(overview.readiness.checks.find((check) => check.key === 'knowledge_mapped')?.status).toBe('passed');
    expect(overview.readiness.checks.find((check) => check.key === 'guardrails_reviewed')?.status).toBe('passed');
    expect(overview.readiness.checks.find((check) => check.key === 'published_agent_roster_valid')?.status).toBe('passed');
    expect(overview.readiness.checks.find((check) => check.key === 'published_workspace_set_valid')?.status).toBe('passed');
    expect(workspaceBindingModel.find).toHaveBeenCalledWith(expect.objectContaining({ programId, enabled: true, $or: [{ visibility: 'program_shared' }, { scopeIds: scopeId }] }));
  });

  it('ignores channel readiness when building scope blockers', async () => {
    const programId = new Types.ObjectId();
    const scopeId = new Types.ObjectId();
    const deploymentId = new Types.ObjectId();
    const revisionId = new Types.ObjectId();
    const agentId = new Types.ObjectId();
    const service = await compileOverview({
      scopeModel: { findOne: jest.fn().mockReturnValue(query({ _id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [agentId], metadata: {}, createdAt: new Date(), updatedAt: new Date() })) },
      workspaceBindingModel: { find: jest.fn().mockReturnValue(query([])) },
      deploymentModel: { findOne: jest.fn().mockReturnValue(query({ _id: deploymentId, programId, scopeId, name: 'Courbevoie public', status: 'dry_run', currentDraftRevisionId: revisionId, channels: { [`${agentId.toString()}:widget`]: { enabled: true, status: 'ready' } }, createdAt: new Date(), updatedAt: new Date() })) },
      revisionModel: { findById: jest.fn().mockReturnValue(query({ _id: revisionId, deploymentId, revisionNumber: 1, status: 'draft', agentId, workspaceIds: [], sourceIds: [], includedSourceIds: [], excludedSourceIds: [], createdBy: agentId, createdAt: new Date(), updatedAt: new Date() })) },
      dryRunModel: { findOne: jest.fn().mockReturnValue(query({ _id: new Types.ObjectId(), programId, scopeId, deploymentId, revisionId, testerId: agentId, status: 'passed', testCases: [], checks: {}, createdAt: new Date(), updatedAt: new Date() })) },
      membershipModel: { find: jest.fn().mockReturnValue(query([])) },
      agentRepository: { findByIds: jest.fn().mockResolvedValue([]) },
      metricModel: { find: jest.fn().mockReturnValue(query([])) },
    });

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
    const service = await compileOverview({
      scopeModel: { findOne: jest.fn().mockReturnValue(query({ _id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [agentId], metadata: {}, createdAt: new Date(), updatedAt: new Date() })) },
      workspaceBindingModel: { find: jest.fn().mockReturnValue(query([])) },
      deploymentModel: { findOne: jest.fn().mockReturnValue(query({ _id: deploymentId, programId, scopeId, name: 'Courbevoie public', status, currentDraftRevisionId: revisionId, currentPublishedRevisionId: revisionId, channels: {}, createdAt: new Date(), updatedAt: new Date() })) },
      revisionModel: { findById: jest.fn().mockReturnValue(query({ _id: revisionId, deploymentId, revisionNumber: 1, status: 'published', agentId, workspaceIds: [], sourceIds: [], includedSourceIds: [], excludedSourceIds: [], createdBy: agentId, createdAt: new Date(), updatedAt: new Date() })) },
      dryRunModel: { findOne: jest.fn().mockReturnValue(query({ _id: new Types.ObjectId(), programId, scopeId, deploymentId, revisionId, testerId: agentId, status: 'passed', testCases: [], checks: {}, createdAt: new Date(), updatedAt: new Date() })) },
      membershipModel: { find: jest.fn().mockReturnValue(query([])) },
      agentRepository: { findByIds: jest.fn().mockResolvedValue([]) },
      metricModel: { find: jest.fn().mockReturnValue(query([])) },
    });

    const overview = await service.getOverview(agentId.toString(), programId.toString(), scopeId.toString());

    expect(overview.deployment?.status).toBe(status);
    expect(overview.readiness.blockers.map(checkKey)).not.toContain(`deployment_${status}`);
    expect(overview.readiness.blockers.map(checkKey)).not.toContain('deployment_status');
  });
});
