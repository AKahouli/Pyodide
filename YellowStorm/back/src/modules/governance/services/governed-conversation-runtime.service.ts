import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ConversationDocument } from '@modules/conversation/schemas/conversation.schema';
import { SendMessageDto } from '@modules/conversation/dto/send-message.dto';
import { GovernanceScope, GovernanceScopeDocument } from '../schemas/governance-scope.schema';
import { GovernanceDeployment, GovernanceDeploymentDocument } from '../schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionDocument } from '../schemas/governance-deployment-revision.schema';
import { GovernanceAudienceAuthorizationService } from './governance-audience-authorization.service';

export interface GovernedConversationRuntime {
  programId: string; scopeId: string; deploymentId: string; revisionId: string; revisionNumber: number;
  primaryAgentId: string; allowedAgentIds: string[]; workspaceIds: string[];
}

@Injectable()
export class GovernedConversationRuntimeService {
  constructor(
    @InjectModel(GovernanceScope.name) private readonly scopeModel: Model<GovernanceScopeDocument>,
    @InjectModel(GovernanceDeployment.name) private readonly deploymentModel: Model<GovernanceDeploymentDocument>,
    @InjectModel(GovernanceDeploymentRevision.name) private readonly revisionModel: Model<GovernanceDeploymentRevisionDocument>,
    private readonly audienceService: GovernanceAudienceAuthorizationService,
  ) {}

  async resolveRuntime(userId: string, conversation: ConversationDocument): Promise<GovernedConversationRuntime> {
    if (conversation.runtimeMode !== 'governed' || !conversation.governanceContext) throw new NotFoundException(ErrorCode.GOVERNED_CONVERSATION_NOT_FOUND);
    if (conversation.createdBy.toString() !== userId) throw new ForbiddenException(ErrorCode.CHAT_FORBIDDEN);
    const context = conversation.governanceContext;
    const [scope, deployment, revision] = await Promise.all([
      this.scopeModel.findOne({ _id: context.scopeId, status: 'active' }).select('_id').lean().exec(),
      this.deploymentModel.findOne({ _id: context.deploymentId, status: 'published' }).select('_id').lean().exec(),
      this.revisionModel.findById(context.revisionId).select('_id').lean().exec(),
    ]);
    if (!scope) throw new ForbiddenException(ErrorCode.GOVERNED_SCOPE_ACCESS_REVOKED);
    try { await this.audienceService.assertUserAuthorized(userId, context.scopeId.toString()); }
    catch { throw new ForbiddenException(ErrorCode.GOVERNED_SCOPE_ACCESS_REVOKED); }
    if (!deployment) throw new ForbiddenException(ErrorCode.GOVERNED_DEPLOYMENT_UNAVAILABLE);
    if (!revision) throw new NotFoundException(ErrorCode.GOVERNED_REVISION_NOT_FOUND);
    return { programId: context.programId.toString(), scopeId: context.scopeId.toString(), deploymentId: context.deploymentId.toString(), revisionId: context.revisionId.toString(), revisionNumber: context.revisionNumber, ...context.runtimeDefinition };
  }

  assertRuntimeRequestAllowed(runtime: GovernedConversationRuntime, dto: SendMessageDto): void {
    if (dto.teamIds?.length || dto.memberIds?.length) throw new BadRequestException(ErrorCode.GOVERNED_TEAM_NOT_ALLOWED);
    if (dto.modelId) throw new BadRequestException(ErrorCode.GOVERNED_MODEL_IMMUTABLE);
    if (dto.connectorRepo || dto.skillIds?.length) throw new BadRequestException(ErrorCode.GOVERNED_CONNECTOR_NOT_ALLOWED);
    const allowed = new Set(runtime.allowedAgentIds);
    if ((dto.agentIds ?? []).some((id) => !allowed.has(id))) throw new ForbiddenException(ErrorCode.GOVERNED_AGENT_NOT_ALLOWED);
  }

  resolveEffectiveAgents(runtime: GovernedConversationRuntime, requestedAgentIds?: string[]): string[] {
    return requestedAgentIds?.length ? [...new Set(requestedAgentIds)] : [runtime.primaryAgentId];
  }
}
