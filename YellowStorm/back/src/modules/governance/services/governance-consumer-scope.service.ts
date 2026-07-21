import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { Agent, AgentDocument } from '@modules/agent/schemas/agent.schema';
import { GovernanceDeployment, GovernanceDeploymentDocument } from '../schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionDocument } from '../schemas/governance-deployment-revision.schema';
import { GovernanceScope, GovernanceScopeDocument } from '../schemas/governance-scope.schema';
import { GovernanceScopeAudienceService } from './governance-scope-audience.service';

export interface AvailableGovernedScope {
  scopeId: string;
  programId: string;
  name: string;
  type: string;
  description?: string;
  deploymentId: string;
  publishedRevisionId: string;
  revisionNumber: number;
  publishedAt?: string;
  primaryAgent: { id: string; name: string; description?: string };
  agentCount: number;
  workspaceCount: number;
  presentation: { icon?: string; accent?: string; shortLabel?: string };
}

@Injectable()
export class GovernanceConsumerScopeService {
  constructor(
    @InjectModel(GovernanceScope.name) private readonly scopeModel: Model<GovernanceScopeDocument>,
    @InjectModel(GovernanceDeployment.name) private readonly deploymentModel: Model<GovernanceDeploymentDocument>,
    @InjectModel(GovernanceDeploymentRevision.name) private readonly revisionModel: Model<GovernanceDeploymentRevisionDocument>,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    private readonly audienceService: GovernanceScopeAudienceService,
    private readonly configService: ConfigService,
  ) {}

  async listAvailable(userId: string): Promise<AvailableGovernedScope[]> {
    if (!this.configService.get<boolean>('governedConversations.carouselEnabled', false)) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Governed scope catalogue is not enabled');
    }
    const scopes = await this.scopeModel.find({ status: 'active' }).select('programId name type metadata audience').lean().exec();
    const authorizedScopes = [] as typeof scopes;
    for (const scope of scopes) {
      if (await this.audienceService.isUserAuthorized(userId, scope._id.toString())) authorizedScopes.push(scope);
    }
    if (!authorizedScopes.length) return [];
    const deployments = await this.deploymentModel.find({ scopeId: { $in: authorizedScopes.map((scope) => scope._id) }, status: 'published', currentPublishedRevisionId: { $exists: true } }).lean().exec();
    const revisions = await this.revisionModel.find({ _id: { $in: deployments.map((deployment) => deployment.currentPublishedRevisionId) }, status: 'published' }).lean().exec();
    const revisionById = new Map(revisions.map((revision) => [revision._id.toString(), revision]));
    const agents = await this.agentModel.find({ _id: { $in: revisions.map((revision) => revision.agentId) }, isActive: true }).select('name description').lean().exec();
    const agentById = new Map(agents.map((agent) => [agent._id.toString(), agent]));
    const scopeById = new Map(authorizedScopes.map((scope) => [scope._id.toString(), scope]));

    return deployments.flatMap((deployment) => {
      const scope = scopeById.get(deployment.scopeId.toString());
      const revision = deployment.currentPublishedRevisionId ? revisionById.get(deployment.currentPublishedRevisionId.toString()) : undefined;
      const agent = revision ? agentById.get(revision.agentId.toString()) : undefined;
      if (!scope || !revision || !agent) return [];
      const metadata = (scope.metadata ?? {}) as { description?: string; presentation?: AvailableGovernedScope['presentation'] };
      const allowedAgentIds = revision.allowedAgentIds?.length ? revision.allowedAgentIds : [revision.agentId];
      return [{
        scopeId: scope._id.toString(),
        programId: scope.programId.toString(),
        name: scope.name,
        type: scope.type,
        description: metadata.description,
        deploymentId: deployment._id.toString(),
        publishedRevisionId: revision._id.toString(),
        revisionNumber: revision.revisionNumber,
        publishedAt: revision.publishedAt?.toISOString(),
        primaryAgent: { id: agent._id.toString(), name: agent.name, description: agent.description },
        agentCount: allowedAgentIds.length,
        workspaceCount: revision.workspaceIds.length,
        presentation: metadata.presentation ?? {},
      }];
    });
  }
}
