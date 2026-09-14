import { Injectable } from '@nestjs/common';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { ConversationResponse } from '@modules/conversation/interfaces/conversation.interface';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { GovernanceScope, GovernanceScopeDocument } from '../schemas/governance-scope.schema';
import { GovernanceDeployment, GovernanceDeploymentDocument } from '../schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionDocument } from '../schemas/governance-deployment-revision.schema';
import { CreateGovernedConversationDto } from '../dto';
import { GovernanceScopeAudienceService } from './governance-scope-audience.service';
import { AgentRepository } from '@modules/agent/repositories/agent.repository';
import { ForbiddenException } from '@modules/exceptions';

@Injectable()
export class GovernedConversationService {
  constructor(
    @InjectModel(GovernanceScope.name) private readonly scopeModel: Model<GovernanceScopeDocument>,
    @InjectModel(GovernanceDeployment.name) private readonly deploymentModel: Model<GovernanceDeploymentDocument>,
    @InjectModel(GovernanceDeploymentRevision.name) private readonly revisionModel: Model<GovernanceDeploymentRevisionDocument>,
    private readonly agentRepository: AgentRepository,
    private readonly audienceService: GovernanceScopeAudienceService,
    private readonly conversationService: ConversationService,
    private readonly featureVisibility: FeatureVisibilityService,
  ) {}

  async create(userId: string, dto: CreateGovernedConversationDto): Promise<ConversationResponse> {
    if (!this.featureVisibility.isEnabled('governedConversations')) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Governed conversations are not enabled');
    }
    const scope = await this.scopeModel.findOne({ _id: new Types.ObjectId(dto.scopeId), status: 'active' }).lean().exec();
    if (!scope) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    await this.audienceService.assertUserAuthorized(userId, dto.scopeId);
    const deployment = await this.deploymentModel.findOne({ scopeId: scope._id, status: 'published', currentPublishedRevisionId: { $exists: true } }).lean().exec();
    if (!deployment?.currentPublishedRevisionId) throw new ConflictException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    const revision = await this.revisionModel.findOne({ _id: deployment.currentPublishedRevisionId, deploymentId: deployment._id, status: 'published' }).lean().exec();
    if (!revision) throw new NotFoundException(ErrorCode.GOVERNANCE_REVISION_NOT_FOUND);
    const allowedAgentIds = (revision.allowedAgentIds?.length ? revision.allowedAgentIds : [revision.agentId]).map(String);
    // No title: governed conversations follow the standard flow and get their
    // name generated from the first message like normal conversations.
    return this.conversationService.createGoverned(userId, {
      requestId: dto.requestId,
      programId: scope.programId.toString(),
      scopeId: scope._id.toString(),
      deploymentId: deployment._id.toString(),
      revisionId: revision._id.toString(),
      revisionNumber: revision.revisionNumber,
      primaryAgentId: revision.agentId.toString(),
      allowedAgentIds,
      workspaceIds: revision.workspaceIds.map(String),
    });
  }

  async getCapabilities(userId: string, conversationId: string): Promise<Record<string, unknown>> {
    const conversation = await this.conversationService.findById(conversationId);
    if (conversation.createdBy !== userId) throw new ForbiddenException(ErrorCode.CHAT_FORBIDDEN);
    if (conversation.runtimeMode !== 'governed' || !conversation.governanceContext) return { runtimeMode: 'standard' };
    await this.audienceService.assertUserAuthorized(userId, conversation.governanceContext.scopeId);
    const [scope, agents, revision] = await Promise.all([
      this.scopeModel.findById(conversation.governanceContext.scopeId).select('name').lean().exec(),
      this.agentRepository.findByIds(conversation.governanceContext.runtimeDefinition.allowedAgentIds.map(String), { activeOnly: true }),
      this.revisionModel.findById(conversation.governanceContext.revisionId).select('publishedAt').lean().exec(),
    ]);
    if (!scope) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    return {
      runtimeMode: 'governed',
      scope: { id: scope._id.toString(), name: scope.name },
      revision: { id: conversation.governanceContext.revisionId, number: conversation.governanceContext.revisionNumber, publishedAt: revision?.publishedAt?.toISOString() },
      agents: agents.map((agent) => ({ id: agent._id.toString(), name: agent.name, description: agent.description, isPrimary: agent._id.toString() === conversation.governanceContext?.runtimeDefinition.primaryAgentId })),
      permissions: { canSelectAgent: agents.length > 1, canSelectWorkspace: false, canSelectModel: false, canSelectConnector: false, canSelectSkills: false, canCreateGroupChat: false, canAttachFiles: true },
    };
  }
}
