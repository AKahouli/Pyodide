import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import whatsappConfig from '@config/whatsapp.config';
import { CryptoService } from '@common/services/crypto.service';
import { AuthModule } from '@modules/auth/auth.module';
import { AgentModule } from '@modules/agent/agent.module';
import { ConversationModule } from '@modules/conversation/conversation.module';
import { ModelsModule } from '@modules/models/models.module';
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
import { WhatsAppSingleAgentStreamService } from './services/whatsapp-single-agent-stream.service';
import { WhatsAppPairingCacheService } from './services/whatsapp-pairing-cache.service';
import { WhatsAppSessionManager } from './services/whatsapp-session.manager';
import { WhatsAppRateLimiterService } from './services/whatsapp-rate-limiter.service';
import { WhatsAppMetricsService } from './services/whatsapp-metrics.service';
import { WhatsAppCircuitBreakerService } from './services/whatsapp-circuit-breaker.service';
import { WhatsAppHealthService } from './services/whatsapp-health.service';

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
    ModelsModule,
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
    WhatsAppSingleAgentStreamService,
    WhatsAppMessageService,
    WhatsAppPairingCacheService,
    WhatsAppRateLimiterService,
    WhatsAppMetricsService,
    WhatsAppCircuitBreakerService,
    WhatsAppGateway,
    WhatsAppHealthService,
  ],
  exports: [WhatsAppHealthService, WhatsAppMetricsService],
})
export class WhatsAppModule {}
