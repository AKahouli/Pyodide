import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import telegramConfig from '@config/telegram.config';
import { CryptoService } from '@common/services/crypto.service';
import { AgentModule } from '@modules/agent/agent.module';
import { ConversationModule } from '@modules/conversation/conversation.module';
import { SystemModule } from '@modules/system/system.module';
import { LoggerModule } from '@modules/logger';
import { UserModule } from '@modules/user/user.module';
import { SharedAgent, SharedAgentSchema } from '@modules/agent/schemas/shared-agent.schema';
import {
  AgentTelegramIntegration,
  AgentTelegramIntegrationSchema,
} from './schemas/agent-telegram-integration.schema';
import { TelegramChatBinding, TelegramChatBindingSchema } from './schemas/telegram-chat-binding.schema';
import { TelegramLinkCode, TelegramLinkCodeSchema } from './schemas/telegram-link-code.schema';
import { TelegramIntegrationController } from './controllers/telegram-integration.controller';
import { TelegramWebhookController } from './controllers/telegram-webhook.controller';
import { TelegramApiService } from './services/telegram-api.service';
import { TelegramIntegrationService } from './services/telegram-integration.service';
import { TelegramLinkCodeService } from './services/telegram-link-code.service';
import { TelegramWebhookService } from './services/telegram-webhook.service';

@Module({
  imports: [
    UserModule,
    ConfigModule.forFeature(telegramConfig),
    MongooseModule.forFeature([
      { name: AgentTelegramIntegration.name, schema: AgentTelegramIntegrationSchema },
      { name: TelegramChatBinding.name, schema: TelegramChatBindingSchema },
      { name: TelegramLinkCode.name, schema: TelegramLinkCodeSchema },
      { name: SharedAgent.name, schema: SharedAgentSchema },
    ]),
    LoggerModule,
    SystemModule,
    AgentModule,
    ConversationModule,
  ],
  controllers: [TelegramIntegrationController, TelegramWebhookController],
  providers: [
    CryptoService,
    TelegramApiService,
    TelegramIntegrationService,
    TelegramLinkCodeService,
    TelegramWebhookService,
  ],
  exports: [TelegramIntegrationService],
})
export class TelegramModule {}
