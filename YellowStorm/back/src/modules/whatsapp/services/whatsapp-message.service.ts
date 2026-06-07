import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { User, UserDocument, UserStatus } from '@modules/user/schemas/user.schema';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';
import { StreamService } from '@modules/conversation/services/stream.service';
import { AgentService } from '@modules/agent/agent.service';
import { LoggerService } from '@modules/logger';
import {
  AgentWhatsAppIntegrationDocument,
  WhatsAppIntegrationStatus,
} from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppChatBinding, WhatsAppChatBindingDocument } from '../schemas/whatsapp-chat-binding.schema';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';

@Injectable()
export class WhatsAppMessageService {
  constructor(
    @InjectModel(WhatsAppChatBinding.name)
    private readonly bindingModel: Model<WhatsAppChatBindingDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly streamService: StreamService,
    private readonly integrationService: WhatsAppIntegrationService,
  ) {
    this.logger.setContext(WhatsAppMessageService.name);
  }

  async handleIncomingMessages(
    integrationId: Types.ObjectId,
    messages: import('@whiskeysockets/baileys').WAMessage[],
    sendReply: (remoteJid: string, text: string) => Promise<void>,
  ): Promise<void> {
    const integration = await this.integrationService
      .getDocumentById(integrationId)
      .catch(() => null);
    if (!integration?.enabled || integration.status !== WhatsAppIntegrationStatus.CONNECTED) {
      return;
    }

    const user = await this.userModel
      .findById(integration.userId)
      .select('status email')
      .lean()
      .exec();
    if (!user || user.status !== UserStatus.ACTIVE) {
      this.logger.warn('WhatsApp message dropped: owner inactive', {
        integrationId: integration._id.toString(),
        userId: integration.userId.toString(),
      });
      return;
    }

    for (const message of messages) {
      if (message.key.fromMe) continue;
      const remoteJid = message.key.remoteJid;
      if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
        continue;
      }

      const text = this.extractText(message);
      if (!text) continue;

      void this.routeMessage({
        integration,
        userId: integration.userId.toString(),
        userEmail: user.email,
        remoteJid,
        messageText: text,
        sendReply,
      }).catch((error) => {
        this.logger.error('WhatsApp message routing failed', {
          integrationId: integration._id.toString(),
          remoteJid,
          error: (error as Error).message,
        });
      });
    }
  }

  private extractText(message: import('@whiskeysockets/baileys').WAMessage): string {
    const content = message.message;
    if (!content) return '';
    if (content.conversation) return content.conversation.trim();
    if (content.extendedTextMessage?.text) return content.extendedTextMessage.text.trim();
    return '';
  }

  private async routeMessage(params: {
    integration: AgentWhatsAppIntegrationDocument;
    userId: string;
    userEmail: string;
    remoteJid: string;
    messageText: string;
    sendReply: (remoteJid: string, text: string) => Promise<void>;
  }): Promise<void> {
    const { integration, userId, userEmail, remoteJid, messageText, sendReply } = params;
    const binding = await this.ensureBinding(integration, remoteJid);
    const conversationId = await this.ensureConversation(binding, userId);

    const userMessage = await this.messageService.createUserMessage({
      conversationId,
      senderId: userId,
      content: messageText,
      requestId: `whatsapp-${Date.now()}`,
      agentIds: [integration.agentId.toString()],
    });

    const aiMessage = await this.messageService.createAIPlaceholder({
      conversationId,
      questionMessageId: userMessage.id,
      requestId: `whatsapp-ai-${Date.now()}`,
    });

    await this.streamService.startStream(
      userId,
      conversationId,
      aiMessage.id,
      {
        content: messageText,
        agentIds: [integration.agentId.toString()],
      },
      undefined,
      userEmail,
      remoteJid,
    );

    const completedMessage = await this.messageService.findById(aiMessage.id);
    const reply = this.truncateReply(this.extractReplyText(completedMessage.components));
    await sendReply(
      remoteJid,
      reply || 'I could not generate a response for this message.',
    );

    const now = new Date();
    await this.bindingModel.updateOne({ _id: binding._id }, { $set: { lastMessageAt: now } }).exec();
    await this.integrationService.updateStatus(integration._id, { lastActivityAt: now });
  }

  private async ensureBinding(
    integration: AgentWhatsAppIntegrationDocument,
    remoteJid: string,
  ): Promise<WhatsAppChatBindingDocument> {
    return this.bindingModel
      .findOneAndUpdate(
        { integrationId: integration._id, remoteJid },
        {
          $set: {
            userId: integration.userId,
            agentId: integration.agentId,
            lastMessageAt: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  private async ensureConversation(
    binding: WhatsAppChatBindingDocument,
    userId: string,
  ): Promise<string> {
    const existingConversationId = binding.conversationId?.toString();
    if (existingConversationId) {
      try {
        await this.conversationService.findById(existingConversationId);
        return existingConversationId;
      } catch {
        this.logger.warn('WhatsApp binding conversation missing, creating new', {
          bindingId: binding._id.toString(),
        });
      }
    }

    const agent = await this.agentService.findUserAgentById(
      userId,
      binding.agentId.toString(),
    );
    const created = await this.conversationService.create(userId, {
      title: `WhatsApp - ${agent.name}`,
    });
    binding.conversationId = new Types.ObjectId(created.id);
    await binding.save();
    return created.id;
  }

  private extractReplyText(
    components?: Array<{ type?: string; data?: Record<string, unknown> }>,
  ): string {
    if (!components?.length) return '';
    const textBlocks = components
      .filter((component) => component.type === 'text')
      .map((component) => String(component.data?.content || ''))
      .filter(Boolean);
    if (textBlocks.length) {
      return textBlocks.join('\n').trim();
    }
    const reasoningBlocks = components
      .filter((component) => component.type === 'reasoning')
      .map((component) => String(component.data?.content || ''))
      .filter(Boolean);
    return reasoningBlocks.join('\n').trim();
  }

  private truncateReply(text: string): string {
    const maxLength = this.configService.get<number>('whatsapp.maxReplyLength', 4000);
    if (!text) return text;
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
  }
}
