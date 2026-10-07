import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { ConversationResponse } from '@modules/conversation/interfaces/conversation.interface';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { AgentRepository } from '@modules/agent/repositories/agent.repository';
import { ForbiddenException } from '@modules/exceptions';
import { CreateGovernedConversationDto } from '../dto';
import { GovernanceScopeAudienceService } from './governance-scope-audience.service';
import { PgRevisionStore } from '../persistence/postgres/pg-revision.store';
import { PgDeploymentStore } from '../persistence/postgres/pg-deployment.store';
import { PgScopeStore } from '../persistence/postgres/pg-scope.store';
import { publishedRootWork } from './governance-root-snapshot';

@Injectable()
export class GovernedConversationService {
  constructor(
    private readonly scopeStore: PgScopeStore,
    private readonly deploymentStore: PgDeploymentStore,
    private readonly revisionStore: PgRevisionStore,
    private readonly agentRepository: AgentRepository,
    private readonly audienceService: GovernanceScopeAudienceService,
    private readonly conversationService: ConversationService,
    private readonly featureVisibility: FeatureVisibilityService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async create(userId: string, dto: CreateGovernedConversationDto): Promise<ConversationResponse> {
    if (!this.featureVisibility.isEnabled('governedConversations')) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Governed conversations are not enabled');
    }
    const scope = await this.scopeStore.findById(dto.scopeId);
    if (!scope || scope.status !== 'active') throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    await this.audienceService.assertUserAuthorized(userId, dto.scopeId);
    const deployments = await this.deploymentStore.listPublishedByScopes([scope.id]);
    const deployment = deployments.find((candidate) => candidate.scopeId === scope.id);
    if (!deployment?.currentPublishedRevisionId) throw new ConflictException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    const revision = await this.revisionStore.findByDeploymentAndId(deployment.id, deployment.currentPublishedRevisionId);
    if (!revision || revision.status !== 'published') throw new NotFoundException(ErrorCode.GOVERNANCE_REVISION_NOT_FOUND);
    const allowedAgentIds = (revision.allowedAgentIds?.length ? revision.allowedAgentIds : [revision.agentId ?? '']).filter(Boolean);
    const rootWork = publishedRootWork(revision.agentSnapshot, revision.id, this.config?.get<string>('INTERNAL_SERVICE_SECRET'));
    if (rootWork && (rootWork.pool.rootAgentId !== revision.agentId || !allowedAgentIds.includes(rootWork.pool.rootAgentId))) {
      throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
    }
    // No title: governed conversations follow the standard flow and get their
    // name generated from the first message like normal conversations.
    return this.conversationService.createGoverned(userId, {
      requestId: dto.requestId,
      programId: scope.programId,
      scopeId: scope.id,
      deploymentId: deployment.id,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      primaryAgentId: revision.agentId ?? '',
      allowedAgentIds,
      workspaceIds: revision.workspaceIds,
      ...(rootWork ? { rootAgentId: rootWork.pool.rootAgentId } : {}),
    });
  }

  async getCapabilities(userId: string, conversationId: string): Promise<Record<string, unknown>> {
    const conversation = await this.conversationService.findById(conversationId);
    if (conversation.createdBy !== userId) throw new ForbiddenException(ErrorCode.CHAT_FORBIDDEN);
    if (conversation.runtimeMode !== 'governed' || !conversation.governanceContext) return { runtimeMode: 'standard' };
    await this.audienceService.assertUserAuthorized(userId, conversation.governanceContext.scopeId);
    const [scope, agents, revision] = await Promise.all([
      this.scopeStore.findById(conversation.governanceContext.scopeId),
      this.agentRepository.findByIds(conversation.governanceContext.runtimeDefinition.allowedAgentIds.map(String), { activeOnly: true }),
      this.revisionStore.findById(conversation.governanceContext.revisionId),
    ]);
    if (!scope) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    return {
      runtimeMode: 'governed',
      scope: { id: scope.id, name: scope.name },
      revision: { id: conversation.governanceContext.revisionId, number: conversation.governanceContext.revisionNumber, publishedAt: revision?.publishedAt?.toISOString() },
      agents: agents.map((agent) => ({ id: agent._id.toString(), name: agent.name, description: agent.description, isPrimary: agent._id.toString() === conversation.governanceContext?.runtimeDefinition.primaryAgentId })),
      permissions: { canSelectAgent: agents.length > 1, canSelectWorkspace: false, canSelectModel: false, canSelectConnector: false, canSelectSkills: false, canCreateGroupChat: false, canAttachFiles: true },
    };
  }
}
