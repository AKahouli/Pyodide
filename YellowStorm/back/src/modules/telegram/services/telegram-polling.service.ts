import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TELEGRAM_INTEGRATION_STORE,
  type TelegramIntegrationRow,
  type TelegramIntegrationStore,
} from '../persistence/telegram.store';
import { TelegramUpdate } from '../interfaces/telegram-update.interface';
import { TelegramApiService } from './telegram-api.service';
import { TelegramIntegrationService } from './telegram-integration.service';
import { TelegramWebhookService } from './telegram-webhook.service';
import { LoggerService } from '@modules/logger';

/**
 * Dev-mode fallback when no public HTTPS webhook URL is available (local
 * machines). Enabled with TELEGRAM_POLLING=true; mutually exclusive with
 * webhooks (Telegram rejects getUpdates while a webhook is registered).
 */
@Injectable()
export class TelegramPollingService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    @Inject(TELEGRAM_INTEGRATION_STORE)
    private readonly integrationStore: TelegramIntegrationStore,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly telegramApiService: TelegramApiService,
    private readonly integrationService: TelegramIntegrationService,
    private readonly webhookService: TelegramWebhookService,
  ) {
    this.logger.setContext(TelegramPollingService.name);
  }

  onModuleInit(): void {
    if (!this.configService.get<boolean>('telegram.pollingEnabled', false)) return;
    const intervalMs = this.configService.get<number>('telegram.pollingIntervalMs', 3000);
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.logger.log('Telegram polling started', { intervalMs });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const integrations = await this.integrationStore.listEnabled();
      for (const integration of integrations) {
        await this.pollIntegration(integration);
      }
    } catch (error) {
      this.logger.error('Telegram polling tick failed', { error: (error as Error).message });
    } finally {
      this.ticking = false;
    }
  }

  private async pollIntegration(
    integration: TelegramIntegrationRow,
  ): Promise<void> {
    try {
      const botToken = this.integrationService.getDecryptedToken(integration);
      const offset = integration.lastUpdateId ? integration.lastUpdateId + 1 : undefined;
      const updates = await this.telegramApiService.getUpdates(botToken, offset);

      // Process a batch concurrently so one slow agent turn does not block the
      // next visitor. Dedupe is per-update id, so ordering is not required.
      const concurrency = this.configService.get<number>('telegram.pollingConcurrency', 5);
      await this.runWithConcurrency(updates, concurrency, (update) =>
        this.webhookService.handlePollingUpdate(integration, update),
      );
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('409')) {
        this.logger.warn('Telegram polling skipped: webhook still registered for this bot', {
          integrationId: integration.id,
        });
        return;
      }
      this.logger.warn('Telegram polling failed for integration', {
        integrationId: integration.id,
        error: message,
      });
    }
  }

  private async runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    if (items.length === 0) return;
    const size = Math.max(1, Math.min(limit, items.length));
    let cursor = 0;
    const runners = Array.from({ length: size }, async () => {
      while (cursor < items.length) {
        const current = cursor++;
        await worker(items[current]);
      }
    });
    await Promise.all(runners);
  }
}
