import { Injectable } from '@nestjs/common';
import { ConversationService } from '../services/conversation.service';
import { RootWorkService } from './root-work.service';

@Injectable()
export class RootInputService {
  constructor(private readonly conversations: ConversationService, private readonly work: RootWorkService) {}

  async getPendingInputs(conversationId: string, actorId: string) {
    const conversation = await this.conversations.getConversationDocument(conversationId);
    // General conversation read access also includes guests/project readers.
    // Pending execution input is private to the creator who started it.
    if (conversation.createdBy !== actorId || conversation.isArchived || conversation.isGroup) return [];
    const epoch = conversation.rootWorkEpoch ?? 0;
    const roots = await this.work.listWaitingRoots(conversationId, epoch);
    return roots.filter((root) => root.rootAgentId === conversation.rootAgentId
      && root.resultPayload?.nativeState?.actorId === actorId).map((root) => ({
      executionId: root.id, epoch,
      inputs: root.resultPayload!.nativeState!.pendingInputs.map((input) => ({
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
