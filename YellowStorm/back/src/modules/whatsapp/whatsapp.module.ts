import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import whatsappConfig from '@config/whatsapp.config';
import { CryptoService } from '@common/services/crypto.service';
import { AuthModule } from '@modules/auth/auth.module';
import { AgentModule } from '@modules/agent/agent.module';
import { ConversationModule } from '@modules/conversation/conversation.module';
import { LoggerModule } from '@modules/logger';
import { User, UserSchema } from '@modules/user/schemas/user.schema';
import { BaileysClientFactory } from './baileys/baileys-client.factory';
import { MongoBaileysAuthStore } from './baileys/mongo-auth-state';
import { WhatsAppIntegrationController } from './controllers/whatsapp-integration.controller';
import { WhatsAppGateway } from './gateways/whatsapp.gateway';
import {
  AgentWhatsAppIntegration,
  AgentWhatsAppIntegrationSchema,
} from './schemas/agent-whatsapp-integration.schema';
import { WhatsAppAuthSession, WhatsAppAuthSessionSchema } from './schemas/whatsapp-auth-session.schema';
import { WhatsAppChatBinding, WhatsAppChatBindingSchema } from './schemas/whatsapp-chat-binding.schema';
import { WhatsAppConnectivityService } from './services/whatsapp-connectivity.service';
import { WhatsAppConnectionService } from './services/whatsapp-connection.service';
import { WhatsAppIntegrationService } from './services/whatsapp-integration.service';
import { WhatsAppMessageService } from './services/whatsapp-message.service';
import { WhatsAppPairingCacheService } from './services/whatsapp-pairing-cache.service';
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
    ]),
    LoggerModule,
    AgentModule,
    ConversationModule,
  ],
  controllers: [WhatsAppIntegrationController],
  providers: [
    CryptoService,
    WhatsAppConnectivityService,
    BaileysClientFactory,
    MongoBaileysAuthStore,
    WhatsAppIntegrationService,
    WhatsAppConnectionService,
    WhatsAppSessionManager,
    WhatsAppMessageService,
    WhatsAppPairingCacheService,
    WhatsAppGateway,
  ],
})
export class WhatsAppModule {}
