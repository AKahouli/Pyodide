import { Injectable } from '@nestjs/common';
import { ConflictException, ErrorCode } from '../../exceptions';
import { RootDelegateResolverService } from '../../agent/services/root-delegate-resolver.service';
import { AgentRepository } from '../../agent/repositories/agent.repository';
import { AgentExecutionSnapshotService } from '../../agent/services/agent-execution-snapshot.service';
import { GovernedConversationRuntimeService } from '../../governance/services/governed-conversation-runtime.service';
import { ConversationService } from '../services/conversation.service';
import type { IGrpcAgent } from '../../agent/interfaces/agent.interface';

/** Conversation authority precedes profile compilation, including deferred jobs. */
@Injectable()
export class ConversationRootResolverService {
  constructor(private readonly conversations: ConversationService, private readonly ordinary: RootDelegateResolverService,
    private readonly governance: GovernedConversationRuntimeService, private readonly agents: AgentRepository,
    private readonly snapshots: AgentExecutionSnapshotService) {}

  async resolveForActor(rootId: string, actorId: string, conversationId: string, expectedRevision?: unknown) {
    const conversation = await this.conversations.getConversationDocument(conversationId);
    if (conversation.createdBy !== actorId || conversation.isArchived || conversation.rootAgentId !== rootId) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Root conversation authority changed');
    }
    if (conversation.runtimeMode !== 'governed') return this.ordinary.resolveForActor(rootId, actorId);
    const runtime = await this.governance.resolveRuntime(actorId, conversation);
    const pool = runtime.rootWork?.pool;
    if (!pool || pool.rootAgentId !== rootId || runtime.primaryAgentId !== rootId
      || (expectedRevision !== undefined && expectedRevision !== runtime.revisionId)
      || pool.entries.some((entry) => !runtime.allowedAgentIds.includes(entry.agentId))) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Published Root authority changed');
    }
    const records = await this.agents.findByIds([rootId, ...pool.entries.map((entry) => entry.agentId)], { activeOnly: true });
    const expected = new Map([[rootId, pool.rootSnapshotDigest], ...pool.entries.map((entry) => [entry.agentId, entry.snapshotDigest] as [string, string])]);
    if (records.length !== expected.size || records.some((agent) => this.snapshots.computeDigest(agent) !== expected.get(agent._id))) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Published Root profile changed');
    }
    return pool;
  }

  async authorizedWorkspaces(conversationId: string, actorId: string, requested: string[]): Promise<string[]> {
    const conversation = await this.conversations.getConversationDocument(conversationId);
    if (conversation.runtimeMode !== 'governed') return this.conversations.filterAccessibleWorkspaceIds(actorId, requested);
    const runtime = await this.governance.resolveRuntime(actorId, conversation);
    return requested.filter((id) => runtime.workspaceIds.includes(id));
  }

  async restrictDefinition(conversationId: string, actorId: string, definition: IGrpcAgent): Promise<IGrpcAgent> {
    const conversation = await this.conversations.getConversationDocument(conversationId);
    if (conversation.runtimeMode !== 'governed') return definition;
    const runtime = await this.governance.resolveRuntime(actorId, conversation);
    return { ...definition, brain_context: definition.brain_context.filter((context) => runtime.workspaceIds.includes(context.workspace_id))
      .map((context) => ({ ...context, workspace_documents: (context.workspace_documents ?? [])
        .filter((document) => runtime.workspaceIds.includes(document.workspace_id)) })) };
  }

  async assertWorkspaces(conversationId: string, actorId: string, requested: string[]): Promise<void> {
    const approved = await this.authorizedWorkspaces(conversationId, actorId, requested);
    if (requested.some((id) => !approved.includes(id))) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Governed source access changed');
    }
  }
}
