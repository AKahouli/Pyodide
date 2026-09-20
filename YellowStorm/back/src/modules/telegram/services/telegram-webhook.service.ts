import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { User, UserStatus } from '@modules/user/schemas/user.schema';
import type { AuthUser } from '@common/auth/auth-user';
import type { UserDocument } from '@modules/user/schemas/user.schema';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';
import { StreamService } from '@modules/conversation/services/stream.service';
import { sanitizeSerializedToolValue } from '@modules/conversation/utils/public-component-sanitizer';
import { ConversationSettingsService } from '@modules/system/conversation-settings.service';
import { LoggerService } from '@modules/logger';
import { AgentService } from '@modules/agent/agent.service';
import { TelegramChatBinding, TelegramChatBindingDocument } from '../schemas/telegram-chat-binding.schema';
import { TelegramUpdate } from '../interfaces/telegram-update.interface';
import { TelegramIntegrationService } from './telegram-integration.service';
import { TelegramApiService } from './telegram-api.service';
import { TelegramLinkCodeService } from './telegram-link-code.service';

@Injectable()
export class TelegramWebhookService {
  constructor(
    @InjectModel(TelegramChatBinding.name)
    private readonly bindingModel: Model<TelegramChatBindingDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly streamService: StreamService,
    private readonly integrationService: TelegramIntegrationService,
    private readonly telegramApiService: TelegramApiService,
    private readonly linkCodeService: TelegramLinkCodeService,
    private readonly conversationSettings: ConversationSettingsService,
  ) {
    this.logger.setContext(TelegramWebhookService.name);
  }

  async validateAndDispatch(
    integrationId: string,
    secretToken: string | undefined,
    update: TelegramUpdate,
  ): Promise<void> {
    const integration = await this.integrationService.validateWebhookSecret(
      integrationId,
      secretToken,
    );
    const markStatus = await this.integrationService.markWebhookUpdate(
      integrationId,
      update.update_id,
    );
    if (markStatus === 'duplicate') {
      this.logger.debug('Skipping duplicate Telegram update', {
        integrationId,
        updateId: update.update_id,
      });
      return;
    }

    // Respond to Telegram immediately; message processing continues async.
    void this.processUpdate(integration._id, update).catch((error) => {
      this.logger.error('Telegram update processing failed', {
        integrationId,
        updateId: update.update_id,
        error: (error as Error).message,
      });
    });
  }

  private async processUpdate(
    integrationId: Types.ObjectId,
    update: TelegramUpdate,
  ): Promise<void> {
    const message = update.message;
    if (!message?.chat?.id) return;

    const chatId = String(message.chat.id);
    const telegramUserId = message.from?.id ? String(message.from.id) : undefined;
    const text = (message.text || '').trim();
    if (!text) return;

    const integration = await this.integrationService.getByIntegrationId(integrationId.toString());
    const botToken = this.integrationService.getDecryptedToken(integration);

    if (text.startsWith('/start')) {
      await this.handleStartCommand(integration._id, botToken, chatId, telegramUserId, text);
      return;
    }

    const binding = await this.bindingModel
      .findOne({ integrationId: integration._id, telegramChatId: chatId })
      .exec();
    if (!binding) {
      await this.telegramApiService.sendMessage(
        botToken,
        chatId,
        'This chat is not linked yet. Use /start <link_code> to connect it.',
      );
      return;
    }

    if (!integration.enabled) {
      await this.telegramApiService.sendMessage(
        botToken,
        chatId,
        'Telegram integration is disabled for this agent.',
      );
      return;
    }

    const user = await this.userModel
      .findById(binding.userId)
      .select('status email')
      .lean()
      .exec();
    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.telegramApiService.sendMessage(
        botToken,
        chatId,
        'Your platform account is not active. Please contact support.',
      );
      return;
    }

    await this.routeMessageToAgent({
      botToken,
      binding,
      userId: binding.userId.toString(),
      userEmail: user.email,
      messageText: text,
      chatId,
      telegramUserId,
    });
  }

  private async handleStartCommand(
    integrationId: Types.ObjectId,
    botToken: string,
    chatId: string,
    telegramUserId: string | undefined,
    text: string,
  ): Promise<void> {
    const parts = text.split(/\s+/);
    const code = parts[1]?.trim();
    if (!code) {
      await this.telegramApiService.sendMessage(
        botToken,
        chatId,
        'Please provide a link code: /start <code>',
      );
      return;
    }

    const linkCode = await this.linkCodeService.consumeCodeOrThrow(code, integrationId);
    const now = new Date();
    await this.bindingModel.findOneAndUpdate(
      {
        integrationId,
        telegramChatId: chatId,
      },
      {
        $set: {
          userId: linkCode.userId,
          agentId: linkCode.agentId,
          telegramUserId,
          lastMessageAt: now,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    await this.telegramApiService.sendMessage(
      botToken,
      chatId,
      'Telegram chat successfully linked. You can now send messages to your agent.',
    );
  }

  private async routeMessageToAgent(params: {
    botToken: string;
    binding: TelegramChatBindingDocument;
    userId: string;
    userEmail: string;
    messageText: string;
    chatId: string;
    telegramUserId?: string;
  }): Promise<void> {
    const {
      botToken,
      binding,
      userId,
      userEmail,
      messageText,
      chatId,
      telegramUserId,
    } = params;

    const conversationId = await this.ensureConversationForBinding(binding, userId);

    const userMessage = await this.messageService.createUserMessage({
      conversationId,
      senderId: userId,
      content: messageText,
      requestId: `telegram-${Date.now()}`,
      agentIds: [binding.agentId.toString()],
    });

    const aiMessage = await this.messageService.createAIPlaceholder({
      conversationId,
      questionMessageId: userMessage.id,
      requestId: `telegram-ai-${Date.now()}`,
    });

    await this.streamService.runSingleAgentStream({
      userId,
      username: userEmail,
      conversationId,
      messageId: aiMessage.id,
      agentId: binding.agentId.toString(),
      query: messageText,
      requestId: aiMessage.requestId,
    });

    const completedMessage = await this.messageService.findById(aiMessage.id);
    // Outbound replies leave the platform for external chat history — keep the
    // external-channel redaction that the conversation view no longer applies.
    const reply = this.truncateReply(sanitizeSerializedToolValue(
      this.extractReplyText(completedMessage.components),
      { redactSensitiveText: this.conversationSettings.shouldRedactSensitiveText() !== false },
    ));
    await this.telegramApiService.sendMessage(
      botToken,
      chatId,
      reply || 'I could not generate a response for this message.',
    );

    await this.bindingModel.updateOne(
      { _id: binding._id },
      {
        $set: {
          lastMessageAt: new Date(),
          telegramUserId,
        },
      },
    );
  }

  private async ensureConversationForBinding(
    binding: TelegramChatBindingDocument,
    userId: string,
  ): Promise<string> {
    const existingConversationId = binding.conversationId?.toString();
    if (existingConversationId) {
      try {
        await this.conversationService.findById(existingConversationId);
        return existingConversationId;
      } catch {
        this.logger.warn('Telegram binding conversation missing, creating a new one', {
          bindingId: binding._id.toString(),
          conversationId: existingConversationId,
        });
      }
    }

    const agent = await this.agentService.findUserAgentById(userId, binding.agentId.toString());
    const created = await this.conversationService.create(userId, {
      title: `Telegram - ${agent.name}`,
    });
    binding.conversationId = new Types.ObjectId(created.id);
    await binding.save();
    return created.id;
  }

  private extractReplyText(components?: Array<{ type?: string; data?: Record<string, unknown> }>): string {
    if (!components?.length) return '';
    const textBlocks = components
      .filter((component) => component.type === 'text')
      .map((component) => String(component.data?.content || ''))
      .filter(Boolean);
    if (textBlocks.length) {
      return textBlocks.join('\n').trim();
    }
    const activityBlocks = components
      .filter((component) => component.type === 'agentActivity')
      .map((component) => String(component.data?.summary || ''))
      .filter(Boolean);
    return activityBlocks.join('\n').trim();
  }

  private truncateReply(text: string): string {
    const maxLength = this.configService.get<number>('telegram.maxReplyLength', 3900);
    if (!text) return text;
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
  }
}
