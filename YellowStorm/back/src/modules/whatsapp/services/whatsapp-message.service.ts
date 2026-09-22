import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { USER_LOOKUP_PORT, type UserLookupPort } from '@common/ports/user-lookup.port';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '@common/auth/auth-user';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';
import { sanitizeSerializedToolValue } from '@modules/conversation/utils/public-component-sanitizer';
import { ConversationSettingsService } from '@modules/system/conversation-settings.service';
import { AgentService } from '@modules/agent/agent.service';
import { LoggerService } from '@modules/logger';
import { WorkyWhatsAppIntegrationService } from '@modules/worky/services/worky-whatsapp-integration.service';
import { WhatsAppStreamService } from './whatsapp-stream.service';
import {
  AgentWhatsAppIntegrationDocument,
  WhatsAppIntegrationStatus,
} from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppChatBinding, WhatsAppChatBindingDocument } from '../schemas/whatsapp-chat-binding.schema';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import {
  toAgentIntegrationRef,
  toWorkyIntegrationRef,
  type WhatsAppIntegrationRef,
} from '../interfaces/whatsapp-integration-ref.interface';
import { extractWhatsAppReplyText } from '../utils/whatsapp-reply-text.util';
import { normalizeWhatsappUserJid } from '../utils/whatsapp-user-jid.util';

@Injectable()
export class WhatsAppMessageService {
  constructor(
    @InjectModel(WhatsAppChatBinding.name)
    private readonly bindingModel: Model<WhatsAppChatBindingDocument>,
    @Inject(USER_LOOKUP_PORT)
    private readonly userLookup: UserLookupPort,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly streamService: WhatsAppStreamService,
    private readonly agentIntegrationService: WhatsAppIntegrationService,
    private readonly workyIntegrationService: WorkyWhatsAppIntegrationService,
    private readonly conversationSettings: ConversationSettingsService,
  ) {
    this.logger.setContext(WhatsAppMessageService.name);
  }

  async handleIncomingMessages(
    integrationRef: WhatsAppIntegrationRef,
    messages: import('@whiskeysockets/baileys').WAMessage[],
    sendReply?: (remoteJid: string, text: string) => Promise<void>,
    selfJids: string[] = [],
  ): Promise<void> {
    if (integrationRef.kind === 'worky_stream') {
      return;
    }

    if (!integrationRef.enabled || integrationRef.status !== WhatsAppIntegrationStatus.CONNECTED) {
      this.logger.warn('WhatsApp message dropped: integration not connected', {
        integrationId: integrationRef.integrationId.toString(),
        kind: integrationRef.kind,
        status: integrationRef.status,
        enabled: integrationRef.enabled,
        messageCount: messages.length,
      });
      return;
    }

    const user = await this.userLookup.byId(String(integrationRef.userId));
    if (!user || user.status !== 'active') {
      this.logger.warn('WhatsApp message dropped: owner inactive', {
        integrationId: integrationRef.integrationId.toString(),
        userId: integrationRef.userId.toString(),
      });
      return;
    }

    // Device suffixes must be stripped on both sides: socket.user carries
    // `81673265873042:74@lid` while self-chat messages arrive on the bare LID.
    const selfSet = new Set(
      selfJids.filter(Boolean).map((jid) => normalizeWhatsappUserJid(jid).toLowerCase()),
    );
    for (const message of messages) {
      const remoteJid = message.key.remoteJid;
      if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
        continue;
      }
      // Owner messages typed in the paired number's own self-chat are routed
      // like normal inbound traffic; other fromMe traffic (owner writing to
      // other contacts, bot send echoes) stays ignored.
      const isSelfChat =
        Boolean(message.key.fromMe) &&
        selfSet.has(normalizeWhatsappUserJid(remoteJid).toLowerCase());
      if (message.key.fromMe && !isSelfChat) continue;

      const text = this.extractText(message);
      if (!text) continue;

      void this.routeAgentMessage({
        integrationRef,
        userId: integrationRef.userId.toString(),
        userEmail: user.email,
        remoteJid,
        messageText: text,
        sendReply,
      }).catch((error) => {
        this.logger.error('WhatsApp message routing failed', {
          integrationId: integrationRef.integrationId.toString(),
          remoteJid,
          kind: integrationRef.kind,
          error: (error as Error).message,
        });
      });
    }
  }

  async resolveIntegrationRef(
    integrationId: Types.ObjectId,
  ): Promise<WhatsAppIntegrationRef | null> {
    const agentDoc = await this.agentIntegrationService
      .getDocumentById(integrationId)
      .catch(() => null);
    if (agentDoc) {
      return toAgentIntegrationRef(agentDoc);
    }
    const workyDoc = await this.workyIntegrationService
      .getDocumentById(integrationId)
      .catch(() => null);
    if (workyDoc) {
      return toWorkyIntegrationRef(workyDoc);
    }
    return null;
  }

  /**
   * Captures texts the owner types in the paired number's own self-chat
   * (fromMe + remoteJid == own JID) into the self binding so the MCP
   * validation tool can long-poll them. Messages the owner sends to other
   * contacts (fromMe + remoteJid == contact) stay ignored, and no agent run
   * is triggered for these captures.
   */
  async captureSelfChatText(
    integrationRef: WhatsAppIntegrationRef,
    messages: import('@whiskeysockets/baileys').WAMessage[],
    selfJids: string[],
  ): Promise<void> {
    if (
      integrationRef.kind !== 'agent' ||
      !integrationRef.enabled ||
      integrationRef.status !== WhatsAppIntegrationStatus.CONNECTED ||
      !integrationRef.agentId
    ) {
      return;
    }
    const phoneDigits = integrationRef.phoneNumber?.replace(/\D/g, '');
    const selfSet = new Set(
      selfJids.filter(Boolean).map((jid) => normalizeWhatsappUserJid(jid).toLowerCase()),
    );
    if (!selfSet.size || !phoneDigits) return;

    for (const message of messages) {
      if (!message.key.fromMe) continue;
      const remoteJid = message.key.remoteJid;
      if (!remoteJid || !selfSet.has(normalizeWhatsappUserJid(remoteJid).toLowerCase())) continue;
      const text = this.extractText(message);
      if (!text) continue;

      await this.bindingModel
        .updateOne(
          { integrationId: integrationRef.integrationId, remoteJid: `${phoneDigits}@s.whatsapp.net` },
          {
            $set: {
              userId: integrationRef.userId,
              agentId: integrationRef.agentId,
              lastMessageAt: new Date(),
              lastInboundText: text,
            },
          },
          { upsert: true },
        )
        .exec();
      this.logger.log('WhatsApp self-chat text captured', {
        integrationId: integrationRef.integrationId.toString(),
        textLength: text.length,
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

  private async routeAgentMessage(params: {
    integrationRef: WhatsAppIntegrationRef;
    userId: string;
    userEmail: string;
    remoteJid: string;
    messageText: string;
    sendReply?: (remoteJid: string, text: string) => Promise<void>;
  }): Promise<void> {
    const { integrationRef, userId, remoteJid, messageText, sendReply } = params;
    if (!sendReply) {
      this.logger.warn('WhatsApp agent route dropped: sendReply missing', {
        integrationId: integrationRef.integrationId.toString(),
      });
      return;
    }

    const agentId = integrationRef.agentId?.toString();
    if (!agentId) {
      return;
    }

    const integration = await this.agentIntegrationService.getDocumentById(
      integrationRef.integrationId,
    );
    const binding = await this.ensureAgentBinding(integration, remoteJid);
    const conversationId = await this.ensureConversation(binding, userId);

    const userMessage = await this.messageService.createUserMessage({
      conversationId,
      senderId: userId,
      content: messageText,
      requestId: `whatsapp-${Date.now()}`,
      agentIds: [agentId],
    });

    const requestId = `whatsapp-${integration._id.toString()}-${Date.now()}`;
    const aiMessage = await this.messageService.createAIPlaceholder({
      conversationId,
      questionMessageId: userMessage.id,
      requestId: `whatsapp-ai-${Date.now()}`,
    });

    this.logger.log('Routing WhatsApp message to RunSingleAgent gRPC', {
      integrationId: integration._id.toString(),
      linkedAgentId: agentId,
      conversationId,
      messageId: aiMessage.id,
      remoteJid,
      requestId,
    });

    const processingTimeoutMs = this.configService.get<number>(
      'whatsapp.processingTimeoutMs',
      180000,
    );
    await Promise.race([
      this.streamService.runStream({
        userId,
        username: params.userEmail,
        conversationId,
        messageId: aiMessage.id,
        linkedAgentId: agentId,
        query: messageText,
        requestId,
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Processing timed out after ${processingTimeoutMs}ms`)),
          processingTimeoutMs,
        ),
      ),
    ]);

    const completedMessage = await this.messageService.findById(aiMessage.id);
    // Outbound replies leave the platform for external chat history — keep the
    // external-channel redaction that the conversation view no longer applies.
    const reply = this.truncateReply(sanitizeSerializedToolValue(
      extractWhatsAppReplyText(completedMessage.components),
      { redactSensitiveText: this.conversationSettings.shouldRedactSensitiveText() !== false },
    ));
    if (!reply) {
      this.logger.warn('WhatsApp reply empty after gRPC stream', {
        integrationId: integration._id.toString(),
        conversationId,
        messageId: aiMessage.id,
        linkedAgentId: agentId,
        componentCount: completedMessage.components?.length ?? 0,
        requestId,
      });
    }
    await sendReply(
      remoteJid,
      reply ||
        this.configService.get<string>(
          'whatsapp.fallbackReply',
          'I could not generate a response for this message.',
        ),
    );

    const now = new Date();
    await this.bindingModel.updateOne({ _id: binding._id }, { $set: { lastMessageAt: now } }).exec();
    await this.agentIntegrationService.updateStatus(integration._id, { lastActivityAt: now });
  }

  private async ensureAgentBinding(
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
      binding.agentId!.toString(),
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
