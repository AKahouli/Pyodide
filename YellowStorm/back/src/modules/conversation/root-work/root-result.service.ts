import { Injectable } from '@nestjs/common';
import { ErrorCode, NotFoundException } from '../../exceptions';
import { ConversationService } from '../services/conversation.service';
import { RootWorkService } from './root-work.service';
import { ConversationRootResolverService } from './conversation-root-resolver.service';

@Injectable()
export class RootResultService {
  constructor(private readonly conversations: ConversationService, private readonly work: RootWorkService,
    private readonly resolver: ConversationRootResolverService) {}

  async getResult(conversationId: string, executionId: string, actorId: string) {
    const execution = await this.authorizeResult(conversationId, executionId, actorId);
    const result = execution.resultPayload!;
    return { executionId, text: result.fullText ?? result.text ?? '',
      complete: result.fullText !== undefined };
  }

  async authorizeResult(conversationId: string, executionId: string, actorId: string) {
    return this.authorizeProducer(conversationId, executionId, actorId, false);
  }

  async authorizeBackgroundExecution(conversationId: string, executionId: string, actorId: string) {
    return this.authorizeProducer(conversationId, executionId, actorId, true);
  }
  async authorizeSynthesisMember(conversationId: string, executionId: string, actorId: string) {
    return this.authorizeProducer(conversationId, executionId, actorId, false, true);
  }

  private async authorizeProducer(conversationId: string, executionId: string, actorId: string, background: boolean, terminalMember = false) {
    const conversation = await this.conversations.getConversationDocument(conversationId);
    const execution = await this.work.getExecution(executionId);
    if (conversation.createdBy !== actorId || conversation.isArchived || conversation.isGroup
      || !execution || execution.conversationId !== conversationId
      || !execution.rootAgentId || execution.rootAgentId !== conversation.rootAgentId
      || execution.conversationEpoch !== (conversation.rootWorkEpoch ?? 0)
      || !['library_worker', 'temporary_worker', 'fanout_driver', 'followup'].includes(execution.role)
      || (terminalMember ? !['completed', 'failed', 'cancelled'].includes(execution.status)
        : background ? execution.resultPayload?.nativeState?.backgroundJobId !== execution.id
        && !execution.resultPayload?.nativeState?.backgroundFanoutItem : execution.status !== 'completed')
      || execution.resultPayload?.nativeState?.actorId !== actorId) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Execution result is unavailable');
    }
    const result = execution.resultPayload;
    const state = result.nativeState!;
    const parent = execution.parentExecutionId ? await this.work.getExecution(execution.parentExecutionId) : null;
    const pool = await this.resolver.resolveForActor(execution.rootAgentId, actorId, conversationId, parent?.resultPayload?.nativeState?.rootContext?.governance_revision ?? null);
    const selected = pool.entries.find((entry) => entry.agentId === state.rootContext.selected_agent_id);
    const manifest = parent?.resultPayload?.nativeState?.fanoutManifests?.find((entry) =>
      entry.manifestId === state.backgroundFanout?.manifestId && entry.digest === state.backgroundFanout?.digest);
    const targetAgentId = manifest?.target.kind === 'library' ? manifest.target.agentId : null;
    const workerAuthorized = execution.role === 'followup'
      ? pool.policy.background.enabled && state.followup?.manifestDigest === parent?.resultPayload?.nativeState?.schedulingSeal?.digest
        && execution.id === parent?.resultPayload?.nativeState?.schedulingSeal?.followupExecutionId
      : execution.role === 'fanout_driver'
      ? manifest?.mode === 'background' && pool.policy.background.enabled && pool.policy.fanout.enabled
        && pool.policy.fanout.allowBackground && (manifest.target.kind === 'temporary' ? pool.policy.temporaryWorkers.enabled
          : pool.delegationEnabled && pool.entries.some((entry) => entry.agentId === targetAgentId
            && (parent?.resultPayload?.nativeState?.rootContext.catalog as Array<{ agent_id: string; snapshot_digest: string }> | undefined)
              ?.some((frozen) => frozen.agent_id === entry.agentId && frozen.snapshot_digest === entry.snapshotDigest)))
      : execution.role === 'temporary_worker'
      ? pool.policy.temporaryWorkers.enabled && state.rootContext.origin_root_agent_id === execution.rootAgentId
        && state.scope.immutableSnapshotRef === pool.rootSnapshotDigest
      : pool.delegationEnabled && Boolean(selected) && selected?.snapshotDigest === state.scope.immutableSnapshotRef;
    const sources = ['fanout_driver', 'followup'].includes(execution.role) ? parent?.resultPayload?.nativeState?.capabilityCeiling?.workspaceIds
      : state.rootContext.source_workspace_ids;
    if (!Array.isArray(sources)) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Result source permissions are unavailable');
    }
    if (Array.isArray(sources)) {
      if (!sources.every((id) => typeof id === 'string')) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Result source permissions are unavailable');
      const accessible = conversation.runtimeMode === 'governed'
        ? await this.resolver.authorizedWorkspaces(conversationId, actorId, sources)
        : await this.conversations.filterAccessibleWorkspaceIds(actorId, sources);
      if (sources.some((id) => !accessible.includes(id))) {
        throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Result source access is unavailable');
      }
    }
    const currentConversation = await this.conversations.getConversationDocument(conversationId);
    if (!workerAuthorized
      || !parent || parent.conversationId !== conversationId
      || parent.resultPayload?.nativeState?.scope.immutableSnapshotRef !== pool.rootSnapshotDigest
      || currentConversation.createdBy !== actorId || currentConversation.rootAgentId !== execution.rootAgentId
      || currentConversation.isArchived || currentConversation.isGroup
      || (currentConversation.rootWorkEpoch ?? 0) !== execution.conversationEpoch) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Execution result is unavailable');
    }
    if (execution.role === 'followup') {
      for (const member of parent.resultPayload!.nativeState!.schedulingSeal!.resultManifest) {
        await this.authorizeSynthesisMember(conversationId, member.executionId, actorId);
      }
    }
    if (conversation.runtimeMode === 'governed') {
      await this.resolver.resolveForActor(execution.rootAgentId, actorId, conversationId,
        parent?.resultPayload?.nativeState?.rootContext?.governance_revision ?? null);
    }
    return execution;
  }
}
