import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { CryptoService } from '@common/services/crypto.service';
import { TelegramApiService } from '@modules/telegram/services/telegram-api.service';
import {
  TELEGRAM_INTEGRATION_STORE,
  type TelegramIntegrationStore,
} from '@modules/telegram/persistence/telegram.store';
import type { ChannelTeardown } from './channels-teardown.token';

/**
 * Telegram agent teardown (plan 4.6): clears the bot webhook, then deletes the
 * integration row (bindings + link codes cascade). Registered in AgentModule —
 * TelegramModule imports AgentModule, so the reverse import would cycle.
 */
@Injectable()
export class TelegramChannelTeardown implements ChannelTeardown {
  constructor(
    @Inject(TELEGRAM_INTEGRATION_STORE)
    private readonly integrationStore: TelegramIntegrationStore,
    private readonly cryptoService: CryptoService,
    private readonly telegramApiService: TelegramApiService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TelegramChannelTeardown.name);
  }

  async deleteForAgent(agentId: string): Promise<void> {
    const integration = await this.integrationStore.findByAgent(agentId);
    if (!integration) return;

    if (integration.encryptedBotToken) {
      try {
        await this.telegramApiService.deleteWebhook(this.cryptoService.decrypt(integration.encryptedBotToken));
      } catch (error) {
        // Row delete must not be blocked by a Telegram API failure.
        this.logger.warn('Telegram webhook clear failed during agent teardown', {
          agentId,
          integrationId: integration.id,
          error: (error as Error).message,
        });
      }
    }
    await this.integrationStore.delete(integration.id);
    this.logger.log('Telegram integration deleted for agent', { agentId, integrationId: integration.id });
  }
}
