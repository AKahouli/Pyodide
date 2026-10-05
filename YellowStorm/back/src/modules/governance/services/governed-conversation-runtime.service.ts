import { Injectable } from '@nestjs/common';
import { BadRequestException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SendMessageDto } from '@modules/conversation/dto/send-message.dto';
import { GovernanceAudienceAuthorizationService } from './governance-audience-authorization.service';
import { PgRevisionStore } from '../persistence/postgres/pg-revision.store';
import { PgDeploymentStore } from '../persistence/postgres/pg-deployment.store';
import { PgScopeStore } from '../persistence/postgres/pg-scope.store';
import { PgBindingStore } from '../persistence/postgres/pg-binding.store';

export interface GovernedConversationRuntime {
  programId: string; scopeId: string; deploymentId: string; revisionId: string; revisionNumber: number;
  primaryAgentId: string; allowedAgentIds: string[]; workspaceIds: string[];
}

export interface GovernedConversationRecord {
  runtimeMode: 'standard' | 'governed';
  createdBy: string;
  governanceContext?: {
    programId: string;
    scopeId: string;
    deploymentId: string;
    revisionId: string;
    revisionNumber: number;
    runtimeDefinition: {
      primaryAgentId: string;
      allowedAgentIds: string[];
      workspaceIds: string[];
    };
  };
}

@Injectable()
export class GovernedConversationRuntimeService {
  constructor(
    private readonly scopeStore: PgScopeStore,
    private readonly deploymentStore: PgDeploymentStore,
    private readonly revisionStore: PgRevisionStore,
    private readonly audienceService: GovernanceAudienceAuthorizationService,
    private readonly bindingStore: PgBindingStore,
  ) {}

  async resolveRuntime(userId: string, conversation: GovernedConversationRecord): Promise<GovernedConversationRuntime> {
    if (conversation.runtimeMode !== 'governed' || !conversation.governanceContext) throw new NotFoundException(ErrorCode.GOVERNED_CONVERSATION_NOT_FOUND);
    if (conversation.createdBy !== userId) throw new ForbiddenException(ErrorCode.CHAT_FORBIDDEN);
    const context = conversation.governanceContext;
    const [scope, deployment, revision] = await Promise.all([
      this.scopeStore.findById(context.scopeId),
      this.deploymentStore.findById(context.deploymentId),
      this.revisionStore.findById(context.revisionId),
    ]);
    if (!scope || scope.status !== 'active') throw new ForbiddenException(ErrorCode.GOVERNED_SCOPE_ACCESS_REVOKED);
    try { await this.audienceService.assertUserAuthorized(userId, context.scopeId); }
    catch { throw new ForbiddenException(ErrorCode.GOVERNED_SCOPE_ACCESS_REVOKED); }
    if (!deployment || deployment.status !== 'published') throw new ForbiddenException(ErrorCode.GOVERNED_DEPLOYMENT_UNAVAILABLE);
    if (!revision) throw new NotFoundException(ErrorCode.GOVERNED_REVISION_NOT_FOUND);
    if (scope.programId !== context.programId || deployment.programId !== context.programId
      || deployment.scopeId !== scope.id || revision.deploymentId !== deployment.id
      || revision.status !== 'published' || revision.revisionNumber !== context.revisionNumber
      || revision.agentId !== context.runtimeDefinition.primaryAgentId
      || !context.runtimeDefinition.allowedAgentIds.includes(context.runtimeDefinition.primaryAgentId)
      || context.runtimeDefinition.allowedAgentIds.some((id) => !revision.allowedAgentIds.includes(id)
        || !scope.agentIds.includes(id))) {
      throw new ForbiddenException(ErrorCode.GOVERNED_DEPLOYMENT_UNAVAILABLE);
    }
    const bindings = await this.bindingStore.listEnabled(context.programId, [context.scopeId]);
    const currentWorkspaces = new Set(bindings.map((binding) => binding.workspaceId));
    const workspaceIds = context.runtimeDefinition.workspaceIds.filter((id) =>
      revision.workspaceIds.includes(id) && currentWorkspaces.has(id));
    return { programId: context.programId, scopeId: context.scopeId, deploymentId: context.deploymentId,
      revisionId: context.revisionId, revisionNumber: context.revisionNumber, ...context.runtimeDefinition, workspaceIds };
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
