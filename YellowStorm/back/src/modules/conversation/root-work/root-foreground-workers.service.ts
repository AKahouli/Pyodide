import { Injectable } from '@nestjs/common';
import { ErrorCode, NotFoundException } from '../../exceptions';
import { ConversationService } from '../services/conversation.service';
import { ConversationRootResolverService } from './conversation-root-resolver.service';
import { RootResultService } from './root-result.service';
import { RootWorkService } from './root-work.service';
import type { RootExecutionRecord } from './root-work.types';

export interface ForegroundWorkerStatus {
  executionId: string; parentExecutionId: string; role: 'temporary_worker' | 'library_worker';
  mode: 'foreground'; status: RootExecutionRecord['status'] | 'queued' | 'not_started'; task: string;
  createdAt: Date; deadline: string; originAssistantMessageId: string; originQuestionMessageId?: string;
}

/** Read-only status from admitted leaves and server-owned finite reservations. */
@Injectable()
export class RootForegroundWorkersService {
  constructor(private readonly conversations: ConversationService, private readonly work: RootWorkService,
    private readonly resolver: ConversationRootResolverService, private readonly results: RootResultService) {}

  async snapshot(conversationId: string, actorId: string) {
    const conversation = await this.conversations.getConversationDocument(conversationId);
    if (conversation.createdBy !== actorId || conversation.isArchived || conversation.isGroup) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Worker status unavailable');
    }
    if (!conversation.rootAgentId) return [];
    const rows = await this.work.listWorkerExecutions(conversationId, conversation.rootWorkEpoch ?? 0);
    const workers: ForegroundWorkerStatus[] = [];
    for (const parent of rows.filter((row) => row.role === 'root')) {
      if (!parent.resultPayload?.nativeState?.fanoutManifests?.some((manifest) => manifest.mode === 'foreground')
        && !rows.some((leaf) => leaf.parentExecutionId === parent.id &&
          !leaf.resultPayload?.nativeState?.backgroundJobId && !leaf.resultPayload?.nativeState?.backgroundFanoutItem)) continue;
      try {
        const pool = await this.authorizeParent(parent, actorId);
        const origin = parent.resultPayload!.nativeState!.origin;
        if (!origin?.assistantMessageId) continue;
        const candidates = new Map<string, { role: ForegroundWorkerStatus['role']; task: string }>();
        for (const manifest of parent.resultPayload!.nativeState!.fanoutManifests ?? []) {
          if (manifest.mode !== 'foreground' || !pool.policy.fanout.enabled) continue;
          const target = manifest.target;
          if (target.kind === 'temporary' ? !pool.policy.temporaryWorkers.enabled : !pool.delegationEnabled
            || !pool.entries.some((entry) => entry.agentId === target.agentId &&
              (parent.resultPayload!.nativeState!.rootContext.catalog as Array<{ agent_id: string; snapshot_digest: string }> | undefined)
                ?.some((frozen) => frozen.agent_id === entry.agentId && frozen.snapshot_digest === entry.snapshotDigest))) continue;
          for (const item of manifest.items) candidates.set(item.executionId, {
            role: target.kind === 'temporary' ? 'temporary_worker' : 'library_worker', task: item.task,
          });
        }
        const leaves = rows.filter((row) => row.parentExecutionId === parent.id &&
          ['temporary_worker', 'library_worker'].includes(row.role) &&
          !row.resultPayload?.nativeState?.backgroundJobId && !row.resultPayload?.nativeState?.backgroundFanoutItem);
        for (const leaf of leaves) candidates.set(leaf.id, {
          role: leaf.role as ForegroundWorkerStatus['role'], task: leaf.resultPayload?.nativeState?.admittedRequest?.task ?? '',
        });
        const projected: ForegroundWorkerStatus[] = [];
        for (const [id, candidate] of candidates) {
          const leaf = leaves.find((row) => row.id === id);
          if (leaf) await this.results.authorizeForegroundWorkerStatus(conversationId, id, actorId);
          projected.push({ executionId: id, parentExecutionId: parent.id, mode: 'foreground', role: candidate.role,
            status: leaf?.status ?? (['running', 'waiting'].includes(parent.status) ? 'queued' : 'not_started'),
            task: candidate.task.slice(0, 240), createdAt: leaf?.createdAt ?? parent.createdAt, deadline: '',
            originAssistantMessageId: origin.assistantMessageId,
            ...(origin.questionMessageId ? { originQuestionMessageId: origin.questionMessageId } : {}) });
        }
        const currentPool = await this.authorizeParent(parent, actorId);
        if (currentPool.delegationEnabled !== pool.delegationEnabled || currentPool.policy.fanout.enabled !== pool.policy.fanout.enabled
          || currentPool.policy.temporaryWorkers.enabled !== pool.policy.temporaryWorkers.enabled
          || currentPool.entries.some((entry) => !pool.entries.some((frozen) => frozen.agentId === entry.agentId && frozen.snapshotDigest === entry.snapshotDigest))
          || pool.entries.some((entry) => !currentPool.entries.some((current) => current.agentId === entry.agentId && current.snapshotDigest === entry.snapshotDigest))) continue;
        workers.push(...projected);
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return workers;
  }

  private async authorizeParent(parent: RootExecutionRecord, actorId: string) {
    const conversation = await this.conversations.getConversationDocument(parent.conversationId);
    const state = parent.resultPayload?.nativeState;
    if (conversation.createdBy !== actorId || conversation.isArchived || conversation.isGroup
      || parent.rootAgentId !== conversation.rootAgentId || parent.conversationEpoch !== (conversation.rootWorkEpoch ?? 0)
      || state?.actorId !== actorId || !parent.rootAgentId || !state.capabilityCeiling) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Worker status unavailable');
    }
    const pool = await this.resolver.resolveForActor(parent.rootAgentId, actorId, parent.conversationId,
      typeof state.rootContext.governance_revision === 'string' ? state.rootContext.governance_revision : null);
    const sources = state.capabilityCeiling.workspaceIds;
    if (!Array.isArray(sources) || sources.some((id) => typeof id !== 'string')) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Worker status unavailable');
    }
    const accessible = conversation.runtimeMode === 'governed'
      ? await this.resolver.authorizedWorkspaces(parent.conversationId, actorId, sources)
      : await this.conversations.filterAccessibleWorkspaceIds(actorId, sources);
    if (pool.rootSnapshotDigest !== state.scope.immutableSnapshotRef || sources.some((id) => !accessible.includes(id))) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Worker status unavailable');
    }
    return pool;
  }
}
