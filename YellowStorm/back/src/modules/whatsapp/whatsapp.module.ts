import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import whatsappConfig from '@config/whatsapp.config';
import { CryptoService } from '@common/services/crypto.service';
import { AuthModule } from '@modules/auth/auth.module';
import { AgentModule } from '@modules/agent/agent.module';
import { ConversationModule } from '@modules/conversation/conversation.module';
import { WorkyModule } from '@modules/worky/worky.module';
import { LoggerModule } from '@modules/logger';
import { Agent, AgentSchema } from '@modules/agent/schemas/agent.schema';
import { SharedAgent, SharedAgentSchema } from '@modules/agent/schemas/shared-agent.schema';
import { User, UserSchema } from '@modules/user/schemas/user.schema';
import { BaileysClientFactory } from './baileys/baileys-client.factory';
import { MongoBaileysAuthStore } from './baileys/mongo-auth-state';
import { WhatsAppIntegrationController } from './controllers/whatsapp-integration.controller';
import { WhatsAppIntegrationEventsController } from './controllers/whatsapp-integration-events.controller';
import { WhatsAppGateway } from './gateways/whatsapp.gateway';
import {
  AgentWhatsAppIntegration,
  AgentWhatsAppIntegrationSchema,
} from './schemas/agent-whatsapp-integration.schema';
import { WhatsAppAuthSession, WhatsAppAuthSessionSchema } from './schemas/whatsapp-auth-session.schema';
import { WhatsAppChatBinding, WhatsAppChatBindingSchema } from './schemas/whatsapp-chat-binding.schema';
import { WhatsAppConnectivityService } from './services/whatsapp-connectivity.service';
import { WhatsAppConnectionService } from './services/whatsapp-connection.service';
import { WorkyWhatsAppConnectionService } from './services/worky-whatsapp-connection.service';
import { WorkyWhatsAppSystemBotConnectionService } from './services/worky-whatsapp-system-bot-connection.service';
import { WorkyWhatsAppGroupService } from './services/worky-whatsapp-group.service';
import { WhatsAppIntegrationService } from './services/whatsapp-integration.service';
import { WhatsAppMessageService } from './services/whatsapp-message.service';
import { WhatsAppStreamService } from './services/whatsapp-stream.service';
import { WhatsAppPairingCacheService } from './services/whatsapp-pairing-cache.service';
import { WhatsAppIntegrationSseService } from './services/whatsapp-integration-sse.service';
import { WhatsAppSessionManager } from './services/whatsapp-session.manager';

@Module({
  imports: [
    ConfigModule.forFeature(whatsappConfig),
    AuthModule,
    MongooseModule.forFeature([
      { name: AgentWhatsAppIntegration.name, schema: AgentWhatsAppIntegrationSchema },
      { name: WhatsAppAuthSession.name, schema: WhatsAppAuthSessionSchema },
      { name: WhatsAppChatBinding.name, schema: WhatsAppChatBindingSchema },
      { name: User.name, schema: UserSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: SharedAgent.name, schema: SharedAgentSchema },
    ]),
    LoggerModule,
    AgentModule,
    ConversationModule,
    forwardRef(() => WorkyModule),
  ],
  controllers: [WhatsAppIntegrationEventsController, WhatsAppIntegrationController],
  providers: [
    CryptoService,
    WhatsAppConnectivityService,
    BaileysClientFactory,
    MongoBaileysAuthStore,
    WhatsAppIntegrationService,
    WhatsAppConnectionService,
    WorkyWhatsAppConnectionService,
    WorkyWhatsAppSystemBotConnectionService,
    WorkyWhatsAppGroupService,
    WhatsAppIntegrationSseService,
    WhatsAppSessionManager,
    WhatsAppStreamService,
    WhatsAppMessageService,
    WhatsAppPairingCacheService,
    WhatsAppGateway,
  ],
  exports: [
    WhatsAppIntegrationService,
    WhatsAppConnectionService,
    WorkyWhatsAppConnectionService,
    WorkyWhatsAppSystemBotConnectionService,
    WorkyWhatsAppGroupService,
  ],
})
export class WhatsAppModule {}

