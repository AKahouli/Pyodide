import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { USER_LOOKUP_PORT, type UserLookupPort } from '@common/ports/user-lookup.port';
import {
  TELEGRAM_BINDING_STORE,
  type TelegramBindingRow,
  type TelegramBindingStore,
  type TelegramIntegrationRow,
} from '../persistence/telegram.store';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';
import { StreamService } from '@modules/conversation/services/stream.service';
import { sanitizeSerializedToolValue } from '@modules/conversation/utils/public-component-sanitizer';
import { ConversationSettingsService } from '@modules/system/conversation-settings.service';
import { LoggerService } from '@modules/logger';
import { AgentService } from '@modules/agent/agent.service';
import { TelegramCallbackQuery, TelegramMessage, TelegramUpdate, TelegramUser } from '../interfaces/telegram-update.interface';
import { TelegramIntegrationService } from './telegram-integration.service';
import { TelegramApiService } from './telegram-api.service';
import { TelegramLinkCodeService } from './telegram-link-code.service';
import { TelegramValidationService } from './telegram-validation.service';

const BINDING_MEMBER = 'member';
const BINDING_GUEST = 'guest';

@Injectable()
export class TelegramWebhookService {
  constructor(
    @Inject(TELEGRAM_BINDING_STORE)
    private readonly bindingStore: TelegramBindingStore,
    @Inject(USER_LOOKUP_PORT)
    private readonly userLookup: UserLookupPort,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly streamService: StreamService,
    private readonly integrationService: TelegramIntegrationService,
    private readonly telegramApiService: TelegramApiService,
    private readonly linkCodeService: TelegramLinkCodeService,
    private readonly validationService: TelegramValidationService,
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
    void this.processUpdate(integration.id, update).catch((error) => {
      this.logger.error('Telegram update processing failed', {
        integrationId,
        updateId: update.update_id,
        error: (error as Error).message,
      });
    });
  }

  async handlePollingUpdate(
    integration: TelegramIntegrationRow,
    update: TelegramUpdate,
  ): Promise<void> {
    const markStatus = await this.integrationService.markWebhookUpdate(
      integration.id,
      update.update_id,
    );
    if (markStatus === 'duplicate') return;

    try {
      await this.processUpdate(integration.id, update);
    } catch (error) {
      this.logger.error('Telegram polling update processing failed', {
        integrationId: integration.id,
        updateId: update.update_id,
        error: (error as Error).message,
      });
    }
  }

  private async processUpdate(
    integrationId: string,
    update: TelegramUpdate,
  ): Promise<void> {
    if (update.callback_query) {
      await this.handleCallbackQuery(integrationId, update.callback_query);
      return;
    }

    const message = update.message;
    if (!message?.chat?.id) return;

    const chatId = String(message.chat.id);
    const telegramUserId = message.from?.id ? String(message.from.id) : undefined;
    const text = (message.text || '').trim();
    if (!text) return;

    const integration = await this.integrationService.getByIntegrationId(integrationId);
    const botToken = this.integrationService.getDecryptedToken(integration);

    if (text.startsWith('/start')) {
      await this.handleStartCommand(integration, botToken, chatId, telegramUserId, message);
      return;
    }

    let binding = await this.bindingStore.findByChat(integration.id, chatId);
    if (!binding) {
      const guestBinding = await this.maybeCreateGuestBinding(
        integration,
        botToken,
        chatId,
        telegramUserId,
        message,
      );
      if (!guestBinding) return;
      binding = guestBinding;
    }

    if (!integration.enabled) {
      await this.telegramApiService.sendMessage(
        botToken,
        chatId,
        'Telegram integration is disabled for this agent.',
      );
      return;
    }

    const user = await this.userLookup.byId(binding.userId);
    if (!user || user.status !== 'active') {
      await this.telegramApiService.sendMessage(
        botToken,
        chatId,
        'Your platform account is not active. Please contact support.',
      );
      return;
    }

    if (binding.bindingType === BINDING_MEMBER) {
      const outcome = await this.validationService.resolveTextReply(
        integration.id,
        telegramUserId,
        text,
        message.reply_to_message?.message_id,
      );
      if (outcome.status === 'resolved') {
        await this.relayValidationResult(integration.id, outcome.result);
        return;
      }
      if (outcome.status === 'ambiguous') {
        return;
      }
    }

    await this.routeMessageToAgent({
      botToken,
      binding,
      userId: binding.userId,
      userEmail: user.email,
      messageText: text,
      chatId,
      telegramUserId,
      guestLabel: binding.bindingType === BINDING_GUEST ? this.getGuestLabel(message.from) : undefined,
    });
  }

  private async handleCallbackQuery(
    integrationId: string,
    callback: TelegramCallbackQuery,
  ): Promise<void> {
    const ownerTelegramUserId = callback.from?.id ? String(callback.from.id) : undefined;
    const result = await this.validationService.resolveCallback(
      callback.id,
      integrationId,
      ownerTelegramUserId,
      callback.data,
    );
    if (!result) return;

    await this.relayValidationResult(integrationId, result);
  }

  private async relayValidationResult(
    integrationId: string,
    result: { question: string; answer: string; guestChatId: string },
  ): Promise<void> {
    // Relay the owner's decision into the guest conversation so the agent
    // processes it in the next turn and relays it to the visitor.
    const integration = await this.integrationService.getByIntegrationId(integrationId);
    const botToken = this.integrationService.getDecryptedToken(integration);

    const binding = await this.bindingStore.findByChat(integration.id, result.guestChatId);
    if (!binding || !binding.conversationId) {
      await this.telegramApiService.sendMessage(
        botToken,
        result.guestChatId,
        'Answer recorded, but the conversation becomes unreachable.',
      );
      return;
    }

    const user = await this.userLookup.byId(binding.userId);
    if (!user || user.status !== 'active') {
      await this.telegramApiService.sendMessage(
        botToken,
        result.guestChatId,
        'Answer recorded, but the agent is currently unavailable.',
      );
      return;
    }

    await this.routeMessageToAgent({
      botToken,
      binding,
      userId: binding.userId,
      userEmail: user.email,
      messageText: `Your owner just answered the validation question "${result.question}" with: ${result.answer}. Use this decision (do not ask again) to continue helping the external visitor.`,
      chatId: result.guestChatId,
      telegramUserId: binding.telegramUserId ?? undefined,
      guestLabel: binding.bindingType === BINDING_GUEST ? 'the external visitor' : undefined,
    });
  }

  private async handleStartCommand(
    integration: TelegramIntegrationRow,
    botToken: string,
    chatId: string,
    telegramUserId: string | undefined,
    message: TelegramMessage,
  ): Promise<void> {
    const text = (message.text || '').trim();
    const parts = text.split(/\s+/);
    const code = parts[1]?.trim();
    if (!code) {
      const guestBinding = await this.maybeCreateGuestBinding(
        integration,
        botToken,
        chatId,
        telegramUserId,
        message,
      );
      if (guestBinding) {
        await this.telegramApiService.sendMessage(
          botToken,
          chatId,
          "You're connected! Send me a message and the agent will reply.",
        );
      }
      return;
    }

    const linkCode = await this.linkCodeService.consumeCodeOrThrow(code, integration.id);
    await this.bindingStore.upsert({
      integrationId: integration.id,
      userId: linkCode.userId,
      agentId: linkCode.agentId,
      telegramChatId: chatId,
      telegramUserId: telegramUserId ?? null,
      bindingType: BINDING_MEMBER,
      lastMessageAt: new Date(),
    });

    await this.telegramApiService.sendMessage(
      botToken,
      chatId,
      'Telegram chat successfully linked. You can now send messages to your agent.',
    );
  }

  private async maybeCreateGuestBinding(
    integration: TelegramIntegrationRow,
    botToken: string,
    chatId: string,
    telegramUserId: string | undefined,
    message: TelegramMessage,
  ): Promise<TelegramBindingRow | null> {
    const isPrivateChat = !message.chat?.type || message.chat.type === 'private';
    const guestInboxEnabled = this.configService.get<boolean>('telegram.guestInboxEnabled', true);
    if (!isPrivateChat || !guestInboxEnabled) {
      await this.telegramApiService.sendMessage(
        botToken,
        chatId,
        'This chat is not linked yet. Use /start <link_code> to connect it.',
      );
      return null;
    }
    if (!integration.enabled) {
      await this.telegramApiService.sendMessage(
        botToken,
        chatId,
        'Telegram integration is disabled for this agent.',
      );
      return null;
    }
    if (!this.checkGuestRateLimit(telegramUserId ?? chatId)) {
      this.logger.warn('Telegram guest message rate limited', {
        integrationId: integration.id,
        chatId,
      });
      await this.telegramApiService.sendMessage(
        botToken,
        chatId,
        'Too many messages received. Please try again later.',
      );
      return null;
    }

    const binding = await this.bindingStore.upsert({
      integrationId: integration.id,
      userId: integration.userId,
      agentId: integration.agentId,
      telegramChatId: chatId,
      telegramUserId: telegramUserId ?? null,
      bindingType: BINDING_GUEST,
      lastMessageAt: new Date(),
    });
    this.logger.log('Telegram guest binding ensured', {
      integrationId: integration.id,
      chatId,
      telegramUserId,
    });
    return binding;
  }

  // ponytail: in-memory per-instance sliding window; swap for a shared store if
  // multiple backend replicas need a consistent guest quota
  private readonly guestMessageTimestamps = new Map<string, number[]>();

  private checkGuestRateLimit(key: string): boolean {
    const limit = this.configService.get<number>('telegram.guestRateLimit', 10);
    const windowMs = this.configService.get<number>('telegram.guestRateWindowMs', 600000);
    const now = Date.now();
    const stamps = (this.guestMessageTimestamps.get(key) ?? []).filter(
      (timestamp) => now - timestamp < windowMs,
    );
    if (stamps.length >= limit) {
      this.guestMessageTimestamps.set(key, stamps);
      return false;
    }
    stamps.push(now);
    this.guestMessageTimestamps.set(key, stamps);
    return true;
  }

  private getGuestLabel(from?: TelegramUser): string {
    if (!from) return 'unknown visitor';
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
    if (name) return name;
    if (from.username) return `@${from.username}`;
    return `Telegram user ${from.id}`;
  }

  private async routeMessageToAgent(params: {
    botToken: string;
    binding: TelegramBindingRow;
    userId: string;
    userEmail: string;
    messageText: string;
    chatId: string;
    telegramUserId?: string;
    guestLabel?: string;
  }): Promise<void> {
    const {
      botToken,
      binding,
      userId,
      userEmail,
      messageText,
      chatId,
      telegramUserId,
      guestLabel,
    } = params;

    const guestPrefix = guestLabel
      ? `[Telegram: message from "${guestLabel}", an external visitor authorized by your owner via this bot. Respond normally as yourself; do not mention this note.]\n`
      : '';
    const conversationId = await this.ensureConversationForBinding(binding, userId);

    const userMessage = await this.messageService.createUserMessage({
      conversationId,
      senderId: userId,
      content: `${guestPrefix}${messageText}`,
      requestId: `telegram-${Date.now()}`,
      agentIds: [binding.agentId],
    });

    const aiMessage = await this.messageService.createAIPlaceholder({
      conversationId,
      questionMessageId: userMessage.id,
      requestId: `telegram-ai-${Date.now()}`,
    });

    // Marks the start of this turn so the fallback can tell apart a validation
    // the agent already created for THIS request from an older pending one.
    const turnStartedAt = new Date();
    await this.streamService.runSingleAgentStream({
      userId,
      username: userEmail,
      conversationId,
      messageId: aiMessage.id,
      agentId: binding.agentId,
      query: `${guestPrefix}${messageText}`,
      requestId: aiMessage.requestId,
      agentParamsExtras:
        binding.bindingType === BINDING_GUEST
          ? {
              telegram_validation_integration_id: binding.integrationId,
              telegram_validation_conversation_id: conversationId,
              telegram_validation_instruction:
                'Telegram external visitor rule: answer directly only when the answer is explicitly available in the conversation or trusted knowledge AND is not time-sensitive. Time-sensitive questions — availability, scheduling, commitments, prices, or anything tied to a specific date, time, or current state — MUST always trigger a fresh request_owner_validation, even if a similar or older answer exists in the conversation; never reuse a past owner answer for a new date, time, or request. If the answer is unavailable, you MUST call request_owner_validation with the concrete question and omit choices so the owner can answer freely in text. Owner validation is the authorized way to decide whether the information may be shared. Do not disclose unavailable information, but do not refuse the validation request solely because the information is private or sensitive: asking the owner for permission is allowed. This rule applies to every unknown request, except requests that must be refused for safety or legal reasons.',
            }
          : undefined,
    });

    const completedMessage = await this.messageService.findById(aiMessage.id);
    // Outbound replies leave the platform for external chat history — keep the
    // external-channel redaction that the conversation view no longer applies.
    const reply = this.truncateReply(sanitizeSerializedToolValue(
      this.extractReplyText(completedMessage.components),
      { redactSensitiveText: this.conversationSettings.shouldRedactSensitiveText() !== false },
    ));
    const isOwnerDecisionTurn = messageText.startsWith('Your owner just answered the validation question');
    const needsOwnerValidation = binding.bindingType === BINDING_GUEST
      && !isOwnerDecisionTurn
      && this.isNonAnswer(reply);
    let outboundReply = reply || 'I could not generate a response for this message.';
    if (needsOwnerValidation) {
      try {
        const pending = await this.validationService.hasPending(
          binding.integrationId,
          conversationId,
          turnStartedAt,
        );
        if (!pending) {
          await this.validationService.create({
            integration_id: binding.integrationId,
            conversation_id: conversationId,
            question: messageText,
            choices: [],
            guest_label: guestLabel,
          });
        }
        outboundReply = "J'ai transmis ta demande à mon propriétaire pour validation.";
      } catch (error) {
        this.logger.warn('Automatic Telegram owner validation fallback failed', {
          integrationId: binding.integrationId,
          error: (error as Error).message,
        });
      }
    }
    await this.telegramApiService.sendMessage(
      botToken,
      chatId,
      outboundReply,
    );

    await this.bindingStore.updateLastMessage(binding.id, new Date());
    if (telegramUserId) {
      await this.bindingStore.update(binding.id, { telegramUserId });
    }
  }

  private isNonAnswer(reply: string): boolean {
    const normalized = reply.toLocaleLowerCase('fr-FR').replace(/[’‘]/g, "'");
    return /\b(je ne peux pas|je n'arrive pas|je ne sais pas|je n'ai pas|je ne dispose pas|je ne connais pas|je ne suis pas en mesure|je ne peux pas confirmer|je l'ignore|pas d'information|aucune information|impossible|je ne peux|je dois vérifier|je vais vérifier|je dois demander|je vais demander|je dois consulter|je vais consulter|je dois me renseigner|je vais me renseigner|je transmets|je vais transmettre|je transmettrai|je vais revenir vers|je reviendrai vers|vérifier auprès|i can't|i cannot|i don't know|i'm not sure|i am not sure|i'll check|i will check|let me check|i'll ask|i will ask|i'll forward|i will forward|unable|not able|no access|private|confidential|priv[ée]|sécuris)\b/.test(normalized);
  }

  private async ensureConversationForBinding(
    binding: TelegramBindingRow,
    userId: string,
  ): Promise<string> {
    const existingConversationId = binding.conversationId?.toString();
    if (existingConversationId) {
      try {
        await this.conversationService.findById(existingConversationId);
        return existingConversationId;
      } catch {
        this.logger.warn('Telegram binding conversation missing, creating a new one', {
          bindingId: binding.id,
          conversationId: existingConversationId,
        });
      }
    }

    const agent = await this.agentService.findUserAgentById(userId, binding.agentId);
    const title =
      binding.bindingType === BINDING_GUEST
        ? `Telegram (guest) - ${agent.name}`
        : `Telegram - ${agent.name}`;
    const created = await this.conversationService.create(userId, {
      title,
    });
    await this.bindingStore.updateLastMessage(binding.id, new Date());
    await this.bindingStore.update(binding.id, { conversationId: created.id });
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
