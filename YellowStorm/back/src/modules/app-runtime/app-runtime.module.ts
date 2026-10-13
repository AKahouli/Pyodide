import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '@modules/auth/auth.module';
import { AppBuilderModule } from '@modules/app-builder/app-builder.module';
import { AppBuilderPersistenceModule } from '@modules/app-builder/persistence/app-builder-persistence.module';
import { AppDataModule } from '@modules/app-data/app-data.module';
import appRuntimeConfig from '@config/app-runtime.config';
import { AppRuntimeInternalController } from './controllers/app-runtime-internal.controller';
import { AppRuntimeMcpController } from './controllers/app-runtime-mcp.controller';
import { AppRuntimeGateway } from './gateways/app-runtime.gateway';
import { PgRuntimeBindingStore } from './persistence/pg-runtime-binding.store';
import { PgRuntimeTicketStore } from './persistence/pg-runtime-ticket.store';
import { PgRuntimeToolCallStore } from './persistence/pg-runtime-tool-call.store';
import { PgRuntimeSourceRevisionStore } from './persistence/pg-runtime-source-revision.store';
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
import { PlatformBaselineService } from './platform-kit/platform-baseline.service';

@Module({
  imports: [
    ConfigModule.forFeature(appRuntimeConfig),
    forwardRef(() => AuthModule),
    // Direct import so template/session stores resolve even when AppBuilderModule
    // is still constructing through the AppRuntime ↔ AppBuilder cycle.
    AppBuilderPersistenceModule,
    forwardRef(() => AppBuilderModule),
    forwardRef(() => AppDataModule),
  ],
  controllers: [AppRuntimeInternalController, AppRuntimeMcpController],
  providers: [
    PgRuntimeBindingStore,
    PgRuntimeTicketStore,
    PgRuntimeToolCallStore,
    PgRuntimeSourceRevisionStore,
    PgRuntimeFinalizedRevisionStore,
    RuntimeTokenService,
    RuntimeRevisionService,
    PlatformBaselineService,
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
    PlatformBaselineService,
    RuntimeFinalizedRevisionService,
    RuntimeMcpAuthService,
    RuntimeMcpDispatcherService,
  ],
})
export class AppRuntimeModule {}
