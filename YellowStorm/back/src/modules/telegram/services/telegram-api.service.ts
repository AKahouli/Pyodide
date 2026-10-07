import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@modules/logger';
import { BadRequestException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { TelegramSendMessageResult, TelegramUpdate } from '../interfaces/telegram-update.interface';

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

@Injectable()
export class TelegramApiService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TelegramApiService.name);
    this.baseUrl = this.configService.get<string>(
      'telegram.apiBaseUrl',
      'https://api.telegram.org',
    );
    this.timeoutMs = this.configService.get<number>('telegram.apiTimeoutMs', 15000);
  }

  async getMe(botToken: string): Promise<{ username?: string; id?: number }> {
    const response = await this.request<{ username?: string; id?: number }>(
      botToken,
      'getMe',
      {},
    );
    return response.result || {};
  }

  async setWebhook(
    botToken: string,
    webhookUrl: string,
    secretToken: string,
  ): Promise<void> {
    const response = await this.request(
      botToken,
      'setWebhook',
      {
        url: webhookUrl,
        secret_token: secretToken,
        drop_pending_updates: false,
      },
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(
        ErrorCode.TELEGRAM_SEND_FAILED,
        response.description || 'Failed to register Telegram webhook',
      );
    }
  }

  async deleteWebhook(botToken: string): Promise<void> {
    await this.request(botToken, 'deleteWebhook', { drop_pending_updates: false });
  }

  async getUpdates(botToken: string, offset?: number): Promise<TelegramUpdate[]> {
    const response = await this.request<TelegramUpdate[]>(botToken, 'getUpdates', {
      offset,
      timeout: 0,
      allowed_updates: ['message', 'callback_query'],
    });
    return response.result ?? [];
  }

  async sendMessageWithButtons(
    botToken: string,
    chatId: string,
    text: string,
    buttons: { text: string; callbackData: string }[],
  ): Promise<TelegramSendMessageResult> {
    const response = await this.request(botToken, 'sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [buttons.map((button) => ({
          text: button.text,
          callback_data: button.callbackData,
        }))],
      },
    });
    return {
      ok: response.ok,
      result: response.result,
      description: response.description,
    };
  }

  async answerCallbackQuery(
    botToken: string,
    callbackQueryId: string,
    text?: string,
    showAlert = false,
  ): Promise<void> {
    await this.request(botToken, 'answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text, show_alert: showAlert } : {}),
    });
  }

  async sendMessage(
    botToken: string,
    chatId: string,
    text: string,
  ): Promise<TelegramSendMessageResult> {
    const response = await this.request(botToken, 'sendMessage', {
      chat_id: chatId,
      text,
    });
    return {
      ok: response.ok,
      result: response.result,
      description: response.description,
    };
  }

  private maskBotToken(botToken: string): string {
    const [botId] = botToken.split(':');
    return botId ? `${botId}:***` : '***';
  }

  private sanitizePayload(
    method: string,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const safe = { ...payload };
    if ('secret_token' in safe) {
      safe.secret_token = '***';
    }
    if (method === 'sendMessage' && typeof safe.text === 'string' && safe.text.length > 120) {
      safe.text = `${safe.text.slice(0, 120)}...`;
    }
    return safe;
  }

  private async request<T = unknown>(
    botToken: string,
    method: string,
    payload: Record<string, unknown>,
  ): Promise<TelegramApiResponse<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, this.timeoutMs);
    const endpoint = `${this.baseUrl}/bot${botToken}/${method}`;
    const startedAt = Date.now();

    this.logger.log('Telegram API request', {
      method,
      botTokenMask: this.maskBotToken(botToken),
      payload: this.sanitizePayload(method, payload),
    });

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn('Telegram API HTTP error', {
          method,
          botTokenMask: this.maskBotToken(botToken),
          httpStatus: res.status,
          durationMs: Date.now() - startedAt,
        });
        throw new ServiceUnavailableException(
          ErrorCode.TELEGRAM_SEND_FAILED,
          `Telegram API request failed with status ${res.status}`,
        );
      }
      const data = (await res.json()) as TelegramApiResponse<T>;
      if (!data.ok) {
        this.logger.warn('Telegram API returned ok=false', {
          method,
          botTokenMask: this.maskBotToken(botToken),
          description: data.description,
          durationMs: Date.now() - startedAt,
        });
        throw new BadRequestException(
          ErrorCode.TELEGRAM_TOKEN_INVALID,
          data.description || `Telegram API ${method} failed`,
        );
      }

      this.logger.log('Telegram API response', {
        method,
        botTokenMask: this.maskBotToken(botToken),
        ok: data.ok,
        description: data.description,
        result: data.result,
        durationMs: Date.now() - startedAt,
      });

      return data;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      this.logger.error('Telegram API request failed', {
        method,
        botTokenMask: this.maskBotToken(botToken),
        error: (error as Error).message,
        durationMs: Date.now() - startedAt,
      });
      throw new ServiceUnavailableException(
        ErrorCode.TELEGRAM_SEND_FAILED,
        `Telegram API ${method} failed`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
