import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PlaybookAssistantMessageRepository } from '../persistence/assistant-message.repository';

const MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface PlaybookAssistantHistoryMessage {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  operationId: string | null;
  createdAt: Date | null;
}

export interface PlaybookAssistantHistory {
  conversationId: string | null;
  messages: PlaybookAssistantHistoryMessage[];
}

@Injectable()
export class PlaybookAssistantHistoryService {
  constructor(private readonly messages: PlaybookAssistantMessageRepository) {}

  async append(input: {
    requestId: string;
    conversationId: string;
    ownerId: string;
    playbookId: string;
    role: 'user' | 'assistant';
    content: string;
    operationId?: string;
  }): Promise<void> {
    await this.messages.appendOnce({
      messageId: randomUUID(),
      ...input,
      operationId: input.operationId ?? null,
      expiresAt: new Date(Date.now() + MESSAGE_RETENTION_MS),
    });
  }

  async list(ownerId: string, playbookId: string, conversationId?: string): Promise<PlaybookAssistantHistory> {
    const resolvedConversationId = conversationId || await this.messages.latestConversationId(ownerId, playbookId);
    if (!resolvedConversationId) return { conversationId: null, messages: [] };

    const messages = await this.messages.listConversation(ownerId, playbookId, resolvedConversationId);
    return {
      conversationId: resolvedConversationId,
      messages: messages.map((message) => ({
        messageId: message.messageId,
        role: message.role,
        content: message.content,
        operationId: message.operationId,
        createdAt: message.createdAt,
      })),
    };
  }
}
