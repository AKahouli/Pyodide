import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Workspace, WorkspaceSchema } from './schemas/workspace.schema';
import { WorkspaceShare, WorkspaceShareSchema } from './schemas/workspace-share.schema';
import { ConversationPersistenceModule } from '../conversation/persistence/conversation-persistence.module';
import { WorkspaceDoc, WorkspaceDocumentSchema } from './schemas/workspace-document.schema';
import { WorkspaceSetting, WorkspaceSettingSchema } from './schemas/workspace-setting.schema';
import { UploadSession, UploadSessionSchema } from './schemas/upload-session.schema';
import {
  WORKSPACE_DOCUMENT_READ_PORT,
  WORKSPACE_DOCUMENT_WRITE_PORT,
  WORKSPACE_READ_PORT,
  WORKSPACE_SETTING_READ_PORT,
  WORKSPACE_SHARE_READ_PORT,
} from './ports';
import { MongoWorkspaceReadAdapter } from './persistence/mongo/mongo-workspace-read.adapter';
import { MongoWorkspaceDocumentReadAdapter } from './persistence/mongo/mongo-workspace-document-read.adapter';
import { MongoWorkspaceDocumentWriteAdapter } from './persistence/mongo/mongo-workspace-document-write.adapter';
import { MongoWorkspaceShareReadAdapter } from './persistence/mongo/mongo-workspace-share-read.adapter';
import { MongoWorkspaceSettingReadAdapter } from './persistence/mongo/mongo-workspace-setting-read.adapter';
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
import { WorkspaceDocumentSupport } from './document/document-support';
import { WorkspaceDocumentRead } from './document/document-read';
import { WorkspaceDocumentWrite } from './document/document-write';
import { WorkspaceDocumentLinks } from './document/document-links';
import { WorkspaceDocumentUploadSessions } from './document/document-upload-sessions';
import { WorkspaceDocumentTree } from './document/document-tree';
import { WorkspaceInitializerService } from './workspace-initializer.service';
import { WorkspaceShareService } from './workspace-share.service';
import { UrlToPdfClientService } from './services/url-to-pdf-client.service';
import { WebsiteCrawlerService } from './services/website-crawler.service';
import { WorkspaceArtifactCleanupService } from './services/workspace-artifact-cleanup.service';
import { GuardedUrlDownloaderService } from './services/guarded-url-downloader.service';
import { RunCodeSourceScopeService } from './services/run-code-source-scope.service';
import { WorkspaceOwnerGuard, WorkspaceAccessGuard, WritePermissionGuard } from './guards';
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
import { FlowReadPortModule } from '../playbook-flow/ports/flow-read-port.module';
import { PgTtlSweeper } from '@modules/postgres/ttl/pg-ttl-sweeper.service';

@Module({
  imports: [
    ConfigModule.forFeature(workspaceConfig),
    MongooseModule.forFeature([
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: WorkspaceShare.name, schema: WorkspaceShareSchema },
      { name: WorkspaceDoc.name, schema: WorkspaceDocumentSchema },
      { name: WorkspaceSetting.name, schema: WorkspaceSettingSchema },
      { name: UploadSession.name, schema: UploadSessionSchema },
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
    ConversationPersistenceModule,
    // FLOW_READ_PORT binding (workspace deletion detaches flows); global module
    // — importing PlaybookFlowModule directly would create a boot-breaking cycle.
    FlowReadPortModule,
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
    WorkspaceDocumentSupport,
    WorkspaceDocumentRead,
    WorkspaceDocumentWrite,
    WorkspaceDocumentLinks,
    WorkspaceDocumentUploadSessions,
    WorkspaceDocumentTree,
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
    MongoWorkspaceReadAdapter,
    { provide: WORKSPACE_READ_PORT, useExisting: MongoWorkspaceReadAdapter },
    MongoWorkspaceDocumentReadAdapter,
    { provide: WORKSPACE_DOCUMENT_READ_PORT, useExisting: MongoWorkspaceDocumentReadAdapter },
    MongoWorkspaceDocumentWriteAdapter,
    { provide: WORKSPACE_DOCUMENT_WRITE_PORT, useExisting: MongoWorkspaceDocumentWriteAdapter },
    MongoWorkspaceShareReadAdapter,
    { provide: WORKSPACE_SHARE_READ_PORT, useExisting: MongoWorkspaceShareReadAdapter },
    MongoWorkspaceSettingReadAdapter,
    { provide: WORKSPACE_SETTING_READ_PORT, useExisting: MongoWorkspaceSettingReadAdapter },
    // Replaces the Mongo TTL index on upload_sessions (plan D.7); swept hourly by PgTtlSweeper.
    {
      provide: 'UPLOAD_SESSION_TTL_REGISTRATION',
      useFactory: (sweeper: PgTtlSweeper): boolean => {
        sweeper.register({ schema: 'workspace', table: 'upload_sessions', column: 'expires_at' });
        return true;
      },
      inject: [PgTtlSweeper],
    },
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
    WORKSPACE_READ_PORT,
    WORKSPACE_DOCUMENT_READ_PORT,
    WORKSPACE_DOCUMENT_WRITE_PORT,
    WORKSPACE_SHARE_READ_PORT,
    WORKSPACE_SETTING_READ_PORT,
  ],
})
export class WorkspaceModule {}
