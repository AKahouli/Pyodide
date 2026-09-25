import { Module } from '@nestjs/common';
import { TELEGRAM_BINDING_STORE, TELEGRAM_INTEGRATION_STORE, TELEGRAM_LINK_CODE_STORE, TELEGRAM_VALIDATION_STORE } from './persistence/telegram.store';
import { PgTelegramBindingStore, PgTelegramIntegrationStore, PgTelegramLinkCodeStore, PgTelegramValidationStore } from './persistence/pg-telegram.store';
import { ConfigModule } from '@nestjs/config';
import telegramConfig from '@config/telegram.config';
import { CryptoService } from '@common/services/crypto.service';
import { AgentModule } from '@modules/agent/agent.module';
import { ConversationModule } from '@modules/conversation/conversation.module';
import { SystemModule } from '@modules/system/system.module';
import { LoggerModule } from '@modules/logger';
import { UserModule } from '@modules/user/user.module';
import { TelegramIntegrationController } from './controllers/telegram-integration.controller';
import { TelegramWebhookController } from './controllers/telegram-webhook.controller';
import { TelegramValidationInternalController } from './controllers/telegram-validation-internal.controller';
import { TelegramApiService } from './services/telegram-api.service';
import { TelegramIntegrationService } from './services/telegram-integration.service';
import { TelegramLinkCodeService } from './services/telegram-link-code.service';
import { TelegramPollingService } from './services/telegram-polling.service';
import { TelegramValidationService } from './services/telegram-validation.service';
import { TelegramWebhookService } from './services/telegram-webhook.service';

@Module({
  imports: [
    UserModule,
    ConfigModule.forFeature(telegramConfig),
    LoggerModule,
    SystemModule,
    AgentModule,
    ConversationModule,
  ],
  controllers: [TelegramIntegrationController, TelegramWebhookController, TelegramValidationInternalController],
  providers: [
    // Telegram cutover (plan 4.7): PG-backed stores.
    { provide: TELEGRAM_INTEGRATION_STORE, useClass: PgTelegramIntegrationStore },
    { provide: TELEGRAM_BINDING_STORE, useClass: PgTelegramBindingStore },
    { provide: TELEGRAM_LINK_CODE_STORE, useClass: PgTelegramLinkCodeStore },
    { provide: TELEGRAM_VALIDATION_STORE, useClass: PgTelegramValidationStore },
    CryptoService,
    TelegramApiService,
    TelegramIntegrationService,
    TelegramLinkCodeService,
    TelegramValidationService,
    TelegramWebhookService,
    TelegramPollingService,
  ],
  exports: [TelegramIntegrationService],
})
export class TelegramModule {}
