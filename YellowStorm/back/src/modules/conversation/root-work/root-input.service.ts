import { Injectable } from '@nestjs/common';
import { ConversationService } from '../services/conversation.service';
import { RootWorkService } from './root-work.service';
import { RootBackgroundJobStore } from '../persistence/postgres/root-background-job.store';
import { RootResultService } from './root-result.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RootInputService {
  constructor(private readonly conversations: ConversationService, private readonly work: RootWorkService,
    private readonly jobs: RootBackgroundJobStore, private readonly results: RootResultService, private readonly config: ConfigService) {}

  async getPendingInputs(conversationId: string, actorId: string) {
    const conversation = await this.conversations.getConversationDocument(conversationId);
    // General conversation read access also includes guests/project readers.
    // Pending execution input is private to the creator who started it.
    if (conversation.createdBy !== actorId || conversation.isArchived || conversation.isGroup) return [];
    const epoch = conversation.rootWorkEpoch ?? 0;
    const roots = await this.work.listWaitingRoots(conversationId, epoch);
    const snapshot = this.config.get<boolean>('conversation.rootBackgroundEnabled', false)
      ? await this.jobs.publicSnapshot(conversationId, actorId) : { epoch, rootAgentId: conversation.rootAgentId, jobs: [] };
    if (snapshot.epoch !== epoch || snapshot.rootAgentId !== conversation.rootAgentId) return [];
    const background = snapshot.jobs.filter((job) => job.status === 'waiting' && job.nativeState?.actorId === actorId);
    for (const job of background) await this.results.authorizeBackgroundExecution(conversationId, job.executionId, actorId);
    const pending = [...roots.filter((root) => root.rootAgentId === conversation.rootAgentId
      && root.resultPayload?.nativeState?.actorId === actorId).map((root) => ({
        id: root.id, mode: 'foreground' as const, state: root.resultPayload!.nativeState!,
      })), ...background.map((job) => ({ id: job.executionId, mode: 'background' as const, state: job.nativeState! }))];
    const current = await this.conversations.getConversationDocument(conversationId);
    if (current.createdBy !== actorId || current.isArchived || current.isGroup
      || current.rootAgentId !== conversation.rootAgentId || (current.rootWorkEpoch ?? 0) !== epoch) return [];
    return pending.map((root) => ({
      executionId: root.id, epoch, ...(root.mode === 'background' ? { mode: root.mode } : {}),
      inputs: root.state.pendingInputs.map((input) => ({
        inputId: input.inputId,
        inputVersion: input.inputVersion ?? 1,
        kind: input.functionName === 'adk_request_confirmation' ? 'confirmation' : 'input',
        ...(input.message ? { message: input.message } : {}),
        ...(input.responseSchema ? { responseSchema: input.responseSchema } : {}),
        ...(input.responseSchemaUnsupported || input.functionName === 'adk_request_input'
          && !input.responseSchema && input.responseSchemaAbsent !== true ? { responseSchemaUnsupported: true } : {}),
      })),
    })).filter((root) => root.inputs.length > 0);
  }
}
