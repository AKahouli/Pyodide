import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PlaybookAssistantMessage, PlaybookAssistantMessageDocument } from '../schemas/playbook-assistant-message.schema';

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
  constructor(
    @InjectModel(PlaybookAssistantMessage.name)
    private readonly messageModel: Model<PlaybookAssistantMessageDocument>,
  ) {}

  async append(input: {
    requestId: string;
    conversationId: string;
    ownerId: string;
    playbookId: string;
    role: 'user' | 'assistant';
    content: string;
    operationId?: string;
  }): Promise<void> {
    await this.messageModel.updateOne(
      { requestId: input.requestId, role: input.role },
      {
        $setOnInsert: {
          messageId: randomUUID(),
          ...input,
          operationId: input.operationId ?? null,
          expiresAt: new Date(Date.now() + MESSAGE_RETENTION_MS),
        },
      },
      { upsert: true },
    ).exec();
  }

  async list(ownerId: string, playbookId: string, conversationId?: string): Promise<PlaybookAssistantHistory> {
    const resolvedConversationId = conversationId || (await this.messageModel
      .findOne({ ownerId, playbookId })
      .sort({ createdAt: -1 })
      .select({ conversationId: 1 })
      .lean()
      .exec())?.conversationId;
    if (!resolvedConversationId) return { conversationId: null, messages: [] };

    const messages = await this.messageModel
      .find({ ownerId, playbookId, conversationId: resolvedConversationId })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    return {
      conversationId: resolvedConversationId,
      messages: messages.map((message) => ({
        messageId: message.messageId,
        role: message.role,
        content: message.content,
        operationId: message.operationId ?? null,
        createdAt: message.createdAt ?? null,
      })),
    };
  }
}
