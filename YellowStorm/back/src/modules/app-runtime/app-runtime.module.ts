import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '@modules/auth/auth.module';
import { ConversationV2Module } from '@modules/conversation-v2/conversation-v2.module';
import { AppDataModule } from '@modules/app-data/app-data.module';
import appRuntimeConfig from '@config/app-runtime.config';
import { AppRuntimeInternalController } from './controllers/app-runtime-internal.controller';
import { AppRuntimeMcpController } from './controllers/app-runtime-mcp.controller';
import { AppRuntimeGateway } from './gateways/app-runtime.gateway';
import { RUNTIME_BINDING_STORE } from './persistence/runtime-binding.store';
import { PgRuntimeBindingStore } from './persistence/pg-runtime-binding.store';
import { RUNTIME_TICKET_STORE } from './persistence/runtime-ticket.store';
import { PgRuntimeTicketStore } from './persistence/pg-runtime-ticket.store';
import { RUNTIME_TOOL_CALL_STORE } from './persistence/runtime-tool-call.store';
import { PgRuntimeToolCallStore } from './persistence/pg-runtime-tool-call.store';
import { RUNTIME_SOURCE_REVISION_STORE } from './persistence/runtime-source-revision.store';
import { PgRuntimeSourceRevisionStore } from './persistence/pg-runtime-source-revision.store';
import { RUNTIME_FINALIZED_REVISION_STORE } from './persistence/runtime-finalized-revision.store';
import { PgRuntimeFinalizedRevisionStore } from './persistence/pg-runtime-finalized-revision.store';
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
import { RuntimeFinalizedRevisionService } from './services/runtime-finalized-revision.service';

@Module({
  imports: [
    ConfigModule.forFeature(appRuntimeConfig),
    forwardRef(() => AuthModule),
    forwardRef(() => ConversationV2Module),
    forwardRef(() => AppDataModule),
  ],
  controllers: [AppRuntimeInternalController, AppRuntimeMcpController],
  providers: [
    { provide: RUNTIME_BINDING_STORE, useClass: PgRuntimeBindingStore },
    { provide: RUNTIME_TICKET_STORE, useClass: PgRuntimeTicketStore },
    { provide: RUNTIME_TOOL_CALL_STORE, useClass: PgRuntimeToolCallStore },
    { provide: RUNTIME_SOURCE_REVISION_STORE, useClass: PgRuntimeSourceRevisionStore },
    { provide: RUNTIME_FINALIZED_REVISION_STORE, useClass: PgRuntimeFinalizedRevisionStore },
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
    RuntimeFinalizedRevisionService,
  ],
  exports: [
    RuntimeTokenService,
    RuntimeBindingService,
    RuntimeTicketService,
    RuntimeRevisionService,
    RuntimeFinalizedRevisionService,
    RuntimeMcpAuthService,
    RuntimeMcpDispatcherService,
  ],
})
export class AppRuntimeModule {}
