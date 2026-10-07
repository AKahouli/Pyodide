import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  TELEGRAM_BINDING_STORE,
  TELEGRAM_INTEGRATION_STORE,
  TELEGRAM_VALIDATION_STORE,
  type TelegramBindingStore,
  type TelegramIntegrationStore,
  type TelegramValidationStore,
} from '../persistence/telegram.store';
import { TelegramIntegrationService } from './telegram-integration.service';
import { TelegramApiService } from './telegram-api.service';

export const CALLBACK_REFUSE = 'refuse';
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_CHOICES = 8;

export const TelegramValidationStatus = {
  PENDING: 'pending',
  ANSWERED: 'answered',
  EXPIRED: 'expired',
  FAILED: 'failed',
} as const;

interface ValidationRequestPayload {
  integration_id: string;
  conversation_id: string;
  question: string;
  choices?: string[];
  guest_label?: string;
}

export interface ValidationCreationResult {
  validationId: string;
  status: typeof TelegramValidationStatus.PENDING;
  ownerChatId: string;
  question: string;
  choices: string[];
}

export type TextReplyOutcome =
  | { status: 'resolved'; result: ValidationCallbackResult }
  | { status: 'ambiguous' }
  | { status: 'none' };

export interface ValidationCallbackResult {
  validationId: string;
  question: string;
  answer: string;
  conversationId: string;
  guestChatId: string;
}

@Injectable()
// ponytail: concurrent requests each create their own pending row; the latest
// owner tap decides. Swap for one-pending-per-conversation contention guard if
// guests start issuing parallel conflicting requests.
export class TelegramValidationService {
  constructor(
    @Inject(TELEGRAM_INTEGRATION_STORE)
    private readonly integrationStore: TelegramIntegrationStore,
    @Inject(TELEGRAM_BINDING_STORE)
    private readonly bindingStore: TelegramBindingStore,
    @Inject(TELEGRAM_VALIDATION_STORE)
    private readonly validationStore: TelegramValidationStore,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly integrationService: TelegramIntegrationService,
    private readonly telegramApiService: TelegramApiService,
  ) {
    this.logger.setContext(TelegramValidationService.name);
  }

  /** Called by the ADK `request_owner_validation` tool via the internal endpoint. */
  async create(payload: ValidationRequestPayload): Promise<ValidationCreationResult> {
    const { integration_id, conversation_id, question } = payload;
    const guestLabel = payload.guest_label?.trim() || undefined;
    const choices = (payload.choices || []).map((choice) => String(choice).trim()).filter(Boolean);

    if (!question?.trim()) {
      throw new BadRequestException(ErrorCode.TELEGRAM_SEND_FAILED, 'question is required');
    }
    if (choices.length > MAX_CHOICES) {
      throw new BadRequestException(
        ErrorCode.TELEGRAM_SEND_FAILED,
        `choices must contain at most ${MAX_CHOICES} entries`,
      );
    }

    const integration = await this.integrationStore.findById(integration_id);
    if (!integration) {
      throw new BadRequestException(ErrorCode.AGENT_NOT_FOUND, 'Telegram integration not found');
    }
    if (!integration.enabled) {
      throw new BadRequestException(ErrorCode.TELEGRAM_INTEGRATION_DISABLED, 'Telegram integration is disabled');
    }
    const botToken = this.integrationService.getDecryptedToken(integration);

    // The owner approves from wherever they linked their personal chat (/start code).
    const ownerBinding = await this.bindingStore.findOwnerBinding(integration.id, integration.userId);
    if (!ownerBinding) {
      throw new ServiceUnavailableException(
        ErrorCode.TELEGRAM_SEND_FAILED,
        "Owner's Telegram chat is not linked yet — the owner must /start the bot with a link code first",
      );
    }
    const guestBinding = await this.bindingStore.findByConversation(integration.id, conversation_id);

    const validation = await this.validationStore.insert({
      integrationId: integration.id,
      agentId: integration.agentId,
      conversationId: conversation_id,
      guestTelegramChatId: guestBinding?.telegramChatId || '',
      guestLabel: guestLabel ?? null,
      question: question.trim(),
      choices,
      status: TelegramValidationStatus.PENDING,
      expiresAt: new Date(Date.now() + this.ttlMs()),
    });

    const guestLine = guestLabel ? `\n👤 ${guestLabel}` : '';
    const validationText = `⚠️ Validation requested by your agent${guestLine}\n\n"${question.trim()}"`;
    const sent = choices.length > 0
      ? await this.telegramApiService.sendMessageWithButtons(
        botToken,
        ownerBinding.telegramChatId,
        validationText,
        choices.map((choice, index) => ({
          text: choice,
          callbackData: this.callbackData(validation.id, index),
        })).concat([{
          text: '❌ Refuse',
          callbackData: this.callbackData(validation.id, CALLBACK_REFUSE),
        }]),
      )
      : await this.telegramApiService.sendMessage(botToken, ownerBinding.telegramChatId, validationText);
    const ownerMessageId = (sent.result as { message_id?: number } | undefined)?.message_id;
    if (ownerMessageId) {
      await this.validationStore.setOwnerMessageId(validation.id, ownerMessageId);
    }

    this.logger.log('Telegram owner validation requested', {
      validationId: validation.id,
      integrationId: integration.id,
      conversationId: conversation_id,
    });

    return {
      validationId: validation.id,
      status: TelegramValidationStatus.PENDING,
      ownerChatId: ownerBinding.telegramChatId,
      question: question.trim(),
      choices,
    };
  }

  async resolveTextReply(
    integrationId: string,
    ownerTelegramUserId: string | undefined,
    text: string,
    replyToMessageId?: number,
  ): Promise<TextReplyOutcome> {
    if (!text.trim() || !ownerTelegramUserId) return { status: 'none' };

    const integration = await this.integrationService.getByIntegrationId(integrationId);
    const ownerBinding = await this.bindingStore.findOwnerBinding(integration.id, integration.userId);
    if (!ownerBinding || String(ownerTelegramUserId) !== String(ownerBinding.telegramUserId || '')) {
      return { status: 'none' };
    }

    const pending = await this.validationStore.findPendingByIntegration(integration.id);
    if (pending.length === 0) return { status: 'none' };

    // Tie the owner's answer to the exact request: prefer the message they
    // replied to; accept a bare reply only when a single request is pending.
    const validation = replyToMessageId
      ? pending.find((candidate) => candidate.ownerMessageId === replyToMessageId)
      : pending.length === 1
        ? pending[0]
        : undefined;

    if (!validation) {
      await this.telegramApiService
        .sendMessage(
          this.integrationService.getDecryptedToken(integration),
          ownerBinding.telegramChatId,
          'Plusieurs demandes sont en attente. Réponds en glissant sur le message de la demande concernée pour associer ta réponse au bon visiteur.',
        )
        .catch(() => undefined);
      return { status: 'ambiguous' };
    }

    await this.validationStore.markAnswered(validation.id, text.trim());
    this.logger.log('Telegram owner validation answered by text', {
      validationId: validation.id,
    });

    return {
      status: 'resolved',
      result: {
        validationId: validation.id,
        question: validation.question,
        answer: text.trim(),
        conversationId: validation.conversationId,
        guestChatId: validation.guestTelegramChatId,
      },
    };
  }

  async hasPending(
    integrationId: string,
    conversationId: string,
    since?: Date,
  ): Promise<boolean> {
    return this.validationStore.hasPendingForConversation(integrationId, conversationId, since);
  }

  /**
   * Records an inline-button answer from the owner chat. Returns the relay
   * payload for the guest flow, or null when the callback is stale/foreign
   * (Telegram gets an inline alert instead).
   */
  async resolveCallback(
    callbackQueryId: string,
    integrationId: string,
    ownerTelegramUserId: string | undefined,
    data: string | undefined,
  ): Promise<ValidationCallbackResult | null> {
    if (!data?.startsWith('hv:')) return null;
    const parts = data.slice(3).split(':');
    const validationId = parts[0];
    const answerValue = parts[1];
    if (!validationId || !answerValue) {
      await this.answerInvalid(callbackQueryId, integrationId, 'Invalid request');
      return null;
    }

    const integration = await this.integrationService.getByIntegrationId(integrationId);
    const botToken = this.integrationService.getDecryptedToken(integration);

    const validation = await this.validationStore.findById(validationId);
    const reject = async (text: string): Promise<null> => {
      await this.telegramApiService.answerCallbackQuery(botToken, callbackQueryId, text, true).catch(() => undefined);
      return null;
    };

    if (!validation) return reject('This request is no longer available');
    if (validation.status !== TelegramValidationStatus.PENDING) return reject('This request was already handled');

    const ownerBinding = await this.bindingStore.findOwnerBinding(validation.integrationId, integration.userId);
    if (!ownerBinding) return reject('Owner chat could not be resolved');
    if (!ownerTelegramUserId || String(ownerTelegramUserId) !== String(ownerBinding.telegramUserId || '')) {
      return reject('Only the bot owner can answer this request');
    }
    if (answerValue !== CALLBACK_REFUSE) {
      const index = Number.parseInt(answerValue, 10);
      if (!Number.isInteger(index) || index < 0 || index >= validation.choices.length) {
        return reject('Invalid choice');
      }
    }
    if (validation.expiresAt.getTime() < Date.now()) {
      await this.validationStore.markExpired(validation.id);
      return reject('This request expired');
    }

    const answer = answerValue === CALLBACK_REFUSE ? 'refused' : validation.choices[Number(answerValue)];
    await this.validationStore.markAnswered(validation.id, answer);

    await this.telegramApiService.answerCallbackQuery(botToken, callbackQueryId, `Answered: ${answer}`);

    this.logger.log('Telegram owner validation answered', {
      validationId: validation.id,
      answer,
    });

    return {
      validationId: validation.id,
      question: validation.question,
      answer,
      conversationId: validation.conversationId,
      guestChatId: validation.guestTelegramChatId,
    };
  }

  private async answerInvalid(
    callbackQueryId: string,
    integrationId: string,
    text: string,
  ): Promise<void> {
    try {
      const integration = await this.integrationService.getByIntegrationId(integrationId);
      const botToken = this.integrationService.getDecryptedToken(integration);
      await this.telegramApiService.answerCallbackQuery(botToken, callbackQueryId, text, true);
    } catch (error) {
      this.logger.warn('Telegram validation callback rejection failed', { error: (error as Error).message });
    }
  }

  private ttlMs(): number {
    return this.configService.get<number>('telegram.validationTtlMs', DEFAULT_TTL_MS);
  }

  private callbackData(validationId: string, choice: string | number): string {
    return `hv:${validationId}:${choice}`;
  }
}
