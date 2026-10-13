import {
  APPLICATION_COMPONENT_EVENT_PUBLISHER,
  APPLICATION_COMPONENT_EVENT_SOURCE,
} from '@modules/app-runtime/ports/application-component-events.port';
import { RUNTIME_SESSION_SEED_SOURCE } from '@modules/app-runtime/ports/runtime-session-seed.port';
import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AppBuilderController } from './app-builder.controller';
import { AppBuilderStreamController } from './app-builder-stream.controller';
import { AdminTemplateCategoryController } from './admin-template-category.controller';
import { AdminTemplateController } from './admin-template.controller';
import { TemplateCatalogController } from './template-catalog.controller';
import { AppBuilderGrpcClientService } from './services/app-builder.grpc-client.service';
import { AppBuilderSessionService } from './services/app-builder-session.service';
import { AppBuilderPointerWriterService } from './services/app-builder-pointer-writer.service';
import { AppBuilderShareService } from './services/app-builder-share.service';
import { AppBuilderEventStoreService } from './services/app-builder-event-store.service';
import { AppBuilderStreamGatewayService } from './services/app-builder-stream-gateway.service';
import { AppBuilderStreamService } from './services/app-builder-stream.service';
import { AppBuilderDeployService } from './services/app-builder-deploy.service';
import { AppBuilderAppShareService } from './services/app-builder-app-share.service';
import { AppBuilderAppAiFeaturesService } from './services/app-builder-app-ai-features.service';
import { AppBuilderTemplatePublishService } from './services/app-builder-template-publish.service';
import { AppBuilderApplicationComponentEvents } from './services/app-builder-application-component-events';
import { AppBuilderSessionSeedSource } from './persistence/app-builder-session-seed.source';
import { AppBuilderTemplateCategoryService } from './services/app-builder-template-category.service';
import { AppBuilderTemplateService } from './services/app-builder-template.service';
import { AppBuilderOwnerGuard } from './guards/app-builder-owner.guard';
import { AppBuilderSessionAccessGuard } from './guards/app-builder-session-access.guard';
import { AppBuilderSessionAccessService } from './services/app-builder-session-access.service';
import { SseAuthGuard } from '@modules/conversation/guards/stream-auth.guard';
import { AuthModule } from '@modules/auth/auth.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { AppRuntimeModule } from '@modules/app-runtime/app-runtime.module';
import { AiProxyModule } from '@modules/ai-proxy/ai-proxy.module';
import { AppDataModule } from '@modules/app-data/app-data.module';
import { WorkspaceModule } from '@modules/workspace/workspace.module';
import { ChatCompletionModule } from '@modules/chat-completion';
import { ModelsModule } from '@modules/models/models.module';
import { SkillModule } from '@modules/skill/skill.module';
import { ConnectorModule } from '@modules/connector/connector.module';
import { EmailModule } from '@modules/email/email.module';
import { UserModule } from '@modules/user/user.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { AppBuilderNameGeneratorService } from './services/app-builder-name-generator.service';
import appBuilderConfig from '@config/app-builder.config';
import { AppBuilderPersistenceModule } from './persistence/app-builder-persistence.module';

@Module({
  imports: [
    ConfigModule.forFeature(appBuilderConfig),
    JwtModule.register({}),
    AppBuilderPersistenceModule,
    forwardRef(() => AuthModule),
    forwardRef(() => WorkspaceModule),
    forwardRef(() => AppRuntimeModule),
    forwardRef(() => AiProxyModule),
    forwardRef(() => AppDataModule),
    UserModule,
    NotificationsModule,
    ChatCompletionModule,
    ModelsModule,
    SkillModule,
    ConnectorModule,
    EmailModule,
    AuthorizationModule,
  ],
  controllers: [
    AppBuilderController,
    AppBuilderStreamController,
    AdminTemplateCategoryController,
    AdminTemplateController,
    TemplateCatalogController,
  ],
  providers: [
    AppBuilderGrpcClientService,
    AppBuilderSessionService,
    SseAuthGuard,
    AppBuilderPointerWriterService,
    AppBuilderShareService,
    AppBuilderEventStoreService,
    AppBuilderStreamGatewayService,
    AppBuilderStreamService,
    AppBuilderOwnerGuard,
    AppBuilderSessionAccessGuard,
    AppBuilderSessionAccessService,
    AppBuilderNameGeneratorService,
    AppBuilderDeployService,
    AppBuilderAppShareService,
    AppBuilderAppAiFeaturesService,
    AppBuilderTemplatePublishService,
    AppBuilderTemplateCategoryService,
    AppBuilderTemplateService,
    AppBuilderSessionSeedSource,
    AppBuilderApplicationComponentEvents,
    { provide: RUNTIME_SESSION_SEED_SOURCE, useExisting: AppBuilderSessionSeedSource },
    {
      provide: APPLICATION_COMPONENT_EVENT_PUBLISHER,
      useExisting: AppBuilderApplicationComponentEvents,
    },
    {
      provide: APPLICATION_COMPONENT_EVENT_SOURCE,
      useExisting: AppBuilderApplicationComponentEvents,
    },
  ],
  exports: [
    AppBuilderPersistenceModule,
    AppBuilderGrpcClientService,
    AppBuilderSessionService,
    AppBuilderPointerWriterService,
    AppBuilderShareService,
    AppBuilderEventStoreService,
    AppBuilderOwnerGuard,
    AppBuilderSessionAccessGuard,
    AppBuilderSessionAccessService,
    AppBuilderStreamService,
    AppBuilderAppShareService,
    AppBuilderTemplateCategoryService,
    AppBuilderTemplateService,
    RUNTIME_SESSION_SEED_SOURCE,
    APPLICATION_COMPONENT_EVENT_PUBLISHER,
    APPLICATION_COMPONENT_EVENT_SOURCE,
  ],
})
export class AppBuilderModule {}
