import { Injectable } from '@nestjs/common';
import type { MessageReplayContext } from '../interfaces/message.interface';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';

export interface ResolvedReplayContext {
  request: MessageReplayContext;
  historical: boolean;
}

@Injectable()
export class CorrectiveReplayContextService {
  constructor(
    private readonly messageService: MessageService,
    private readonly conversationService: ConversationService,
  ) {}

  async resolve(questionMessageId: string): Promise<ResolvedReplayContext | undefined> {
    const question = await this.messageService.getMessageDocument(questionMessageId);
    if (question.replayContext) {
      return { request: question.replayContext, historical: false };
    }

    const conversation = await this.conversationService.getConversationDocument(question.conversationId.toString());
    if (conversation.runtimeMode === 'governed' || !question.content?.trim()) return undefined;

    return {
      historical: true,
      request: {
        content: question.content,
        attachedFileIds: question.attachedFileIds?.map((id) => id.toString()) ?? [],
        webSearchEnabled: question.webSearchEnabled ?? false,
        webConnectorAccessEnabled: true,
        deepSearchEnabled: false,
        modelId: question.modelId,
        agentIds: question.agentIds?.map((id) => id.toString()) ?? [],
        skillIds: [],
      },
    };
  }
}
