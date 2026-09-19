import { Inject, Injectable } from '@nestjs/common';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { AgentRepository } from '@modules/agent/repositories/agent.repository';
import { DEPLOYMENT_STORE, REVISION_STORE, SCOPE_STORE, type DeploymentStore, type RevisionStore, type ScopeStore } from '../persistence';
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
    @Inject(SCOPE_STORE) private readonly scopeStore: ScopeStore,
    @Inject(DEPLOYMENT_STORE) private readonly deploymentStore: DeploymentStore,
    @Inject(REVISION_STORE) private readonly revisionStore: RevisionStore,
    private readonly agentRepository: AgentRepository,
    private readonly audienceService: GovernanceScopeAudienceService,
    private readonly featureVisibility: FeatureVisibilityService,
  ) {}

  async listAvailable(userId: string): Promise<AvailableGovernedScope[]> {
    if (!this.featureVisibility.isEnabled('governedScopeCarousel')) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Governed scope catalogue is not enabled');
    }
    // Active scopes are program-independent (consumer catalogue).
    const activeScopes = await this.scopeStore.listActive();
    const authorizedScopes = [] as typeof activeScopes;
    for (const scope of activeScopes) {
      if (await this.audienceService.isUserAuthorized(userId, scope.id)) authorizedScopes.push(scope);
    }
    if (!authorizedScopes.length) return [];
    const deployments = await this.deploymentStore.listPublishedByScopes(authorizedScopes.map((scope) => scope.id));
    const revisions = await this.revisionStore.listByIds(deployments.map((deployment) => deployment.currentPublishedRevisionId).filter((id): id is string => Boolean(id)));
    const publishedRevisions = revisions.filter((revision) => revision.status === 'published');
    const revisionById = new Map(publishedRevisions.map((revision) => [revision.id, revision]));
    const agents = await this.agentRepository.findByIds(publishedRevisions.map((revision) => revision.agentId ?? '').filter(Boolean), { activeOnly: true });
    const agentById = new Map(agents.map((agent) => [agent._id.toString(), agent]));
    const scopeById = new Map(authorizedScopes.map((scope) => [scope.id, scope]));

    return deployments.flatMap((deployment) => {
      const scope = scopeById.get(deployment.scopeId);
      const revision = deployment.currentPublishedRevisionId ? revisionById.get(deployment.currentPublishedRevisionId) : undefined;
      const agent = revision ? agentById.get(revision.agentId ?? '') : undefined;
      if (!scope || !revision || !agent) return [];
      const metadata = (scope.metadata ?? {}) as { description?: string; presentation?: AvailableGovernedScope['presentation'] };
      const allowedAgentIds = revision.allowedAgentIds?.length ? revision.allowedAgentIds : [revision.agentId ?? ''];
      return [{
        scopeId: scope.id,
        programId: scope.programId,
        name: scope.name,
        type: scope.type,
        description: metadata.description,
        deploymentId: deployment.id,
        publishedRevisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        publishedAt: revision.publishedAt?.toISOString(),
        primaryAgent: { id: agent._id.toString(), name: agent.name, description: agent.description },
        agentCount: allowedAgentIds.filter(Boolean).length,
        workspaceCount: revision.workspaceIds.length,
        presentation: metadata.presentation ?? {},
      }];
    });
  }
}
