import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '@modules/auth/auth.module';
import { ConversationV2Module } from '@modules/conversation-v2/conversation-v2.module';
import { AppDataModule } from '@modules/app-data/app-data.module';
import appRuntimeConfig from '@config/app-runtime.config';
import { AppRuntimeInternalController } from './controllers/app-runtime-internal.controller';
import { AppRuntimeMcpController } from './controllers/app-runtime-mcp.controller';
import { AppRuntimeGateway } from './gateways/app-runtime.gateway';
import {
  AppRuntimeBinding,
  AppRuntimeBindingSchema,
} from './schemas/app-runtime-binding.schema';
import {
  AppRuntimeTicket,
  AppRuntimeTicketSchema,
} from './schemas/app-runtime-ticket.schema';
import {
  AppRuntimeToolCall,
  AppRuntimeToolCallSchema,
} from './schemas/app-runtime-tool-call.schema';
import {
  AppSourceRevision,
  AppSourceRevisionSchema,
} from './schemas/app-source-revision.schema';
import { RuntimeBindingService } from './services/runtime-binding.service';
import { RuntimeBrokerService } from './services/runtime-broker.service';
import { RuntimeConnectionRegistry } from './services/runtime-connection.registry';
import { RuntimeMcpAuthService } from './services/runtime-mcp-auth.service';
import { RuntimeMcpDispatcherService } from './services/runtime-mcp-dispatcher.service';
import { RuntimeRevisionService } from './services/runtime-revision.service';
import { RuntimeTicketService } from './services/runtime-ticket.service';
import { RuntimeTokenService } from './services/runtime-token.service';
import { RuntimeToolDispatcherService } from './services/runtime-tool-dispatcher.service';
import { AppRuntimeConversationNotifierService } from './services/app-runtime-conversation-notifier.service';

@Module({
  imports: [
    ConfigModule.forFeature(appRuntimeConfig),
    forwardRef(() => AuthModule),
    forwardRef(() => ConversationV2Module),
    forwardRef(() => AppDataModule),
    MongooseModule.forFeature([
      { name: AppRuntimeBinding.name, schema: AppRuntimeBindingSchema },
      { name: AppRuntimeTicket.name, schema: AppRuntimeTicketSchema },
      { name: AppRuntimeToolCall.name, schema: AppRuntimeToolCallSchema },
      { name: AppSourceRevision.name, schema: AppSourceRevisionSchema },
    ]),
  ],
  controllers: [AppRuntimeInternalController, AppRuntimeMcpController],
  providers: [
    RuntimeTokenService,
    RuntimeRevisionService,
    RuntimeBindingService,
    RuntimeTicketService,
    RuntimeConnectionRegistry,
    RuntimeToolDispatcherService,
    RuntimeMcpAuthService,
    RuntimeBrokerService,
    RuntimeMcpDispatcherService,
    AppRuntimeGateway,
    AppRuntimeConversationNotifierService,
  ],
  exports: [
    RuntimeTokenService,
    RuntimeBindingService,
    RuntimeTicketService,
    RuntimeRevisionService,
    RuntimeMcpAuthService,
    RuntimeMcpDispatcherService,
  ],
})
export class AppRuntimeModule {}
