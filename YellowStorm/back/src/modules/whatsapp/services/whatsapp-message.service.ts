import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { User, UserDocument, UserStatus } from '@modules/user/schemas/user.schema';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';
import { AgentService } from '@modules/agent/agent.service';
import { LoggerService } from '@modules/logger';
import { WhatsAppSingleAgentStreamService } from './whatsapp-single-agent-stream.service';
import {
  AgentWhatsAppIntegrationDocument,
  WhatsAppIntegrationStatus,
} from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppChatBinding, WhatsAppChatBindingDocument } from '../schemas/whatsapp-chat-binding.schema';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppRateLimiterService } from './whatsapp-rate-limiter.service';
import { WhatsAppMetricsService } from './whatsapp-metrics.service';
import { WhatsAppCircuitBreakerService } from './whatsapp-circuit-breaker.service';
import { extractWhatsAppReplyText } from '../utils/whatsapp-reply-text.util';

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
    private readonly singleAgentStreamService: WhatsAppSingleAgentStreamService,
    private readonly integrationService: WhatsAppIntegrationService,
    private readonly rateLimiter: WhatsAppRateLimiterService,
    private readonly metrics: WhatsAppMetricsService,
    private readonly circuitBreaker: WhatsAppCircuitBreakerService,
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

      const integrationIdStr = integration._id.toString();
      this.metrics.incrementCounter('messages.inbound', {
        integrationId: integrationIdStr,
        agentId: integration.agentId.toString(),
      });

      if (!this.rateLimiter.tryAcquire(integrationIdStr)) {
        this.logger.warn('WhatsApp message dropped: rate limit exceeded', {
          integrationId: integrationIdStr,
          remoteJid,
        });
        void sendReply(
          remoteJid,
          this.configService.get<string>(
            'whatsapp.fallbackReply',
            'I could not generate a response for this message.',
          ),
        ).catch(() => {});
        continue;
      }

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
    const { integration, userId, remoteJid, messageText, sendReply } = params;
    const integrationIdStr = integration._id.toString();
    const adkKey = `adk:${this.configService.get<string>('whatsapp.adkUrl', 'unknown')}`;

    if (!this.circuitBreaker.canExecute(adkKey)) {
      this.metrics.incrementCounter('messages.dropped', { reason: 'circuit_breaker_open' });
      const fallback = this.configService.get<string>('whatsapp.fallbackReply', 'I could not generate a response for this message.');
      await sendReply(remoteJid, fallback).catch(() => {});
      return;
    }

    const binding = await this.ensureBinding(integration, remoteJid);
    const conversationId = await this.ensureConversation(binding, userId);

    const userMessage = await this.messageService.createUserMessage({
      conversationId,
      senderId: userId,
      content: messageText,
      requestId: `whatsapp-${Date.now()}`,
      agentIds: [integration.agentId.toString()],
    });

    const requestId = `whatsapp-${integration._id.toString()}-${Date.now()}`;
    const linkedAgentId = integration.agentId.toString();
    const aiMessage = await this.messageService.createAIPlaceholder({
      conversationId,
      questionMessageId: userMessage.id,
      requestId: `whatsapp-ai-${Date.now()}`,
    });

    this.logger.log('Routing WhatsApp message to ADK single-agent stream', {
      integrationId: integration._id.toString(),
      linkedAgentId,
      conversationId,
      messageId: aiMessage.id,
      remoteJid,
      adkEndpoint: '/agentic/run_single_agent',
      managerOrchestration: false,
      requestId,
    });

    const processingTimeoutMs = this.configService.get<number>(
      'whatsapp.processingTimeoutMs',
      180000,
    );
    const streamPromise = this.singleAgentStreamService.runSingleAgentStream({
      userId,
      conversationId,
      messageId: aiMessage.id,
      linkedAgentId,
      integrationId: integration._id.toString(),
      remoteJid,
      query: messageText,
      requestId,
    });
    try {
      await Promise.race([
        streamPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Processing timed out after ${processingTimeoutMs}ms`)), processingTimeoutMs),
        ),
      ]);
      this.circuitBreaker.recordSuccess(adkKey);
    } catch (streamError) {
      this.circuitBreaker.recordFailure(adkKey);
      throw streamError;
    }

    const completedMessage = await this.messageService.findById(aiMessage.id);
    const reply = this.truncateReply(extractWhatsAppReplyText(completedMessage.components));
    if (!reply) {
      this.logger.warn('WhatsApp reply empty after ADK stream', {
        integrationId: integration._id.toString(),
        conversationId,
        messageId: aiMessage.id,
        linkedAgentId,
        componentCount: completedMessage.components?.length ?? 0,
        requestId,
      });
    }
    await sendReply(
      remoteJid,
      reply || this.configService.get<string>('whatsapp.fallbackReply', 'I could not generate a response for this message.'),
    );

    this.metrics.incrementCounter('messages.outbound', {
      integrationId: integration._id.toString(),
      agentId: integration.agentId.toString(),
    });

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

  private truncateReply(text: string): string {
    const maxLength = this.configService.get<number>('whatsapp.maxReplyLength', 4000);
    if (!text) return text;
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
  }
}
