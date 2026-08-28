import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Workspace, WorkspaceSchema } from './schemas/workspace.schema';
import {
  WorkspaceShare,
  WorkspaceShareSchema,
} from './schemas/workspace-share.schema';
import {
  Conversation,
  ConversationSchema,
} from '../conversation/schemas/conversation.schema';
import { Flow, FlowSchema } from '../playbook-flow/schemas/playbook-flow.schema';
import { WorkspaceDoc, WorkspaceDocumentSchema } from './schemas/workspace-document.schema';
import {
  WorkspaceSetting,
  WorkspaceSettingSchema,
} from './schemas/workspace-setting.schema';
import {
  UploadSession,
  UploadSessionSchema,
} from './schemas/upload-session.schema';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceSettingController } from './workspace-setting.controller';
import { WorkspaceDocumentController } from './workspace-document.controller';
import { WorkspaceIngestController } from './workspace-ingest.controller';
import { WorkspaceInternalController } from './workspace-internal.controller';
import { WorkspaceAccessCheckController } from './workspace-access-check.controller';
import { WorkspaceShareController } from './workspace-share.controller';
import { WorkspaceService } from './workspace.service';
import { WorkspaceSettingService } from './workspace-setting.service';
import { WorkspaceDocumentService } from './workspace-document.service';
import { WorkspaceInitializerService } from './workspace-initializer.service';
import { WorkspaceShareService } from './workspace-share.service';
import { UrlToPdfClientService } from './services/url-to-pdf-client.service';
import { WebsiteCrawlerService } from './services/website-crawler.service';
import { WorkspaceArtifactCleanupService } from './services/workspace-artifact-cleanup.service';
import { GuardedUrlDownloaderService } from './services/guarded-url-downloader.service';
import { RunCodeSourceScopeService } from './services/run-code-source-scope.service';
import {
  WorkspaceOwnerGuard,
  WorkspaceAccessGuard,
  WritePermissionGuard,
} from './guards';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { AuthModule } from '../auth/auth.module';
import { LoggerModule } from '../logger';
import { DocumentModule } from '../document/document.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsageModule } from '../usage/usage.module';
import { IndexingModule } from '../indexing/indexing.module';
import { UserModule } from '../user/user.module';
import workspaceConfig from '../../config/workspace.config';
import { IntegrationEventsModule } from '../integration-events/integration-events.module';
import { SemanticModelModule } from '../semantic-model/semantic-model.module';

@Module({
  imports: [
    ConfigModule.forFeature(workspaceConfig),
    MongooseModule.forFeature([
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: WorkspaceShare.name, schema: WorkspaceShareSchema },
      { name: WorkspaceDoc.name, schema: WorkspaceDocumentSchema },
      { name: WorkspaceSetting.name, schema: WorkspaceSettingSchema },
      { name: UploadSession.name, schema: UploadSessionSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Flow.name, schema: FlowSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UsageModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => IndexingModule),
    UserModule,
    DocumentModule,
    LoggerModule,
    IntegrationEventsModule,
    forwardRef(() => SemanticModelModule),
  ],
  controllers: [
    WorkspaceController,
    WorkspaceSettingController,
    WorkspaceDocumentController,
    WorkspaceIngestController,
    WorkspaceInternalController,
    WorkspaceAccessCheckController,
    WorkspaceShareController,
  ],
  providers: [
    WorkspaceService,
    WorkspaceSettingService,
    WorkspaceDocumentService,
    WebsiteCrawlerService,
    WorkspaceInitializerService,
    WorkspaceShareService,
    WorkspaceOwnerGuard,
    WorkspaceAccessGuard,
    WritePermissionGuard,
    InternalServiceGuard,
    UrlToPdfClientService,
    WorkspaceArtifactCleanupService,
    GuardedUrlDownloaderService,
    RunCodeSourceScopeService,
  ],
  exports: [
    MongooseModule,
    WorkspaceService,
    WorkspaceSettingService,
    WorkspaceDocumentService,
    WorkspaceInitializerService,
    WorkspaceShareService,
    WorkspaceAccessGuard,
    WritePermissionGuard,
    RunCodeSourceScopeService,
  ],
})
export class WorkspaceModule {}
