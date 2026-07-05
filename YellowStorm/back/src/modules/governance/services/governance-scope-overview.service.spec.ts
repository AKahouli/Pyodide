import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { GovernanceScopeOverviewService } from './governance-scope-overview.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceDeployment } from '../schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision } from '../schemas/governance-deployment-revision.schema';
import { GovernanceDryRun } from '../schemas/governance-dry-run.schema';
import { GovernanceMetric } from '../schemas/governance-metric.schema';
import { GovernanceScope } from '../schemas/governance-scope.schema';
import { GovernanceSource } from '../schemas/governance-source.schema';

const execLean = (value: unknown) => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(value) }) });
const sortedLean = (value: unknown) => ({ sort: () => execLean(value) });

describe('GovernanceScopeOverviewService', () => {
  it('aggregates scope readiness around agents, knowledge, deployment, and dry-run state', async () => {
    const programId = new Types.ObjectId();
    const scopeId = new Types.ObjectId();
    const deploymentId = new Types.ObjectId();
    const revisionId = new Types.ObjectId();
    const agentId = new Types.ObjectId();
    const scopeModel = { findOne: jest.fn().mockReturnValue(execLean({ _id: scopeId, programId, name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [agentId], metadata: {}, createdAt: new Date(), updatedAt: new Date() })) };
    const sourceModel = { find: jest.fn().mockReturnValue(sortedLean([{ _id: new Types.ObjectId(), programId, scopeIds: [scopeId], visibility: 'scope_specific', title: 'City workspace', sourceType: 'manual_record', workspaceId: new Types.ObjectId(), status: 'draft', tags: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() }])) };
    const deploymentModel = { findOne: jest.fn().mockReturnValue(sortedLean({ _id: deploymentId, programId, scopeId, name: 'Courbevoie public', status: 'dry_run', currentDraftRevisionId: revisionId, channels: {}, createdAt: new Date(), updatedAt: new Date() })) };
    const revisionModel = { findById: jest.fn().mockReturnValue(execLean({ _id: revisionId, deploymentId, revisionNumber: 1, status: 'draft', agentId, workspaceIds: [], sourceIds: [], includedSourceIds: [], excludedSourceIds: [], createdBy: agentId, createdAt: new Date(), updatedAt: new Date() })) };
    const dryRunModel = { findOne: jest.fn().mockReturnValue(sortedLean({ _id: new Types.ObjectId(), programId, scopeId, deploymentId, revisionId, testerId: agentId, status: 'passed', testCases: [], checks: {}, createdAt: new Date(), updatedAt: new Date() })) };
    const metricModel = { find: jest.fn().mockReturnValue(execLean([{ type: 'usage', channel: 'widget', value: 3 }])) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        GovernanceScopeOverviewService,
        { provide: getModelToken(GovernanceScope.name), useValue: scopeModel },
        { provide: getModelToken(GovernanceSource.name), useValue: sourceModel },
        { provide: getModelToken(GovernanceDeployment.name), useValue: deploymentModel },
        { provide: getModelToken(GovernanceDeploymentRevision.name), useValue: revisionModel },
        { provide: getModelToken(GovernanceDryRun.name), useValue: dryRunModel },
        { provide: getModelToken(GovernanceMetric.name), useValue: metricModel },
        { provide: GovernanceProgramService, useValue: { assertOwnedProgram: jest.fn().mockResolvedValue(undefined) } },
        { provide: GovernanceAccessService, useValue: { assertScopeAccess: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    const overview = await moduleRef.get(GovernanceScopeOverviewService).getOverview(agentId.toString(), programId.toString(), scopeId.toString());

    expect(overview.agents.mappedAgents).toHaveLength(1);
    expect(overview.knowledge.workspaceMappings).toHaveLength(1);
    expect(overview.readiness.blockers).toHaveLength(0);
    expect(overview.metricsSummary.byChannel.widget).toBe(3);
  });
});
