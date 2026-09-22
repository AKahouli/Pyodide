import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConversationPersistenceModule } from '../conversation/persistence/conversation-persistence.module';
import {
  WORKSPACE_DOCUMENT_READ_PORT,
  WORKSPACE_DOCUMENT_WRITE_PORT,
  WORKSPACE_READ_PORT,
  WORKSPACE_SETTING_READ_PORT,
  WORKSPACE_SHARE_READ_PORT,
} from './ports';
import { PgWorkspaceReadAdapter } from './persistence/postgres/pg-workspace-read.adapter';
import { PgWorkspaceDocumentReadAdapter } from './persistence/postgres/pg-workspace-document-read.adapter';
import { PgWorkspaceDocumentWriteAdapter } from './persistence/postgres/pg-workspace-document-write.adapter';
import { PgWorkspaceShareReadAdapter } from './persistence/postgres/pg-workspace-share-read.adapter';
import { PgWorkspaceSettingReadAdapter } from './persistence/postgres/pg-workspace-setting-read.adapter';
import { PgWorkspaceStore } from './stores/postgres/pg-workspace-store';
import { PgDocumentStore } from './stores/postgres/pg-document-store';
import { PgShareStore } from './stores/postgres/pg-share-store';
import { PgSettingStore } from './stores/postgres/pg-setting-store';
import { PgUploadSessionStore } from './stores/postgres/pg-upload-session-store';
import {
  WORKSPACE_STORE,
  DOCUMENT_STORE,
  SHARE_STORE,
  SETTING_STORE,
  UPLOAD_SESSION_STORE,
} from './stores';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceSettingController } from './workspace-setting.controller';
import { WorkspaceDocumentController } from './workspace-document.controller';
import { WorkspaceIngestController } from './workspace-ingest.controller';
import { WorkspaceInternalController } from './workspace-internal.controller';
import { WorkspaceAssetInternalController } from './workspace-asset-internal.controller';
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
import { PostgresModule } from '@modules/postgres/postgres.module';

@Module({
  imports: [
    ConfigModule.forFeature(workspaceConfig),
    PostgresModule,
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
    WorkspaceAssetInternalController,
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
    // D.10 cutover: PostgreSQL is now the system of record for the workspace domain.
    PgWorkspaceReadAdapter,
    { provide: WORKSPACE_READ_PORT, useExisting: PgWorkspaceReadAdapter },
    PgWorkspaceDocumentReadAdapter,
    { provide: WORKSPACE_DOCUMENT_READ_PORT, useExisting: PgWorkspaceDocumentReadAdapter },
    PgWorkspaceDocumentWriteAdapter,
    { provide: WORKSPACE_DOCUMENT_WRITE_PORT, useExisting: PgWorkspaceDocumentWriteAdapter },
    PgWorkspaceShareReadAdapter,
    { provide: WORKSPACE_SHARE_READ_PORT, useExisting: PgWorkspaceShareReadAdapter },
    PgWorkspaceSettingReadAdapter,
    { provide: WORKSPACE_SETTING_READ_PORT, useExisting: PgWorkspaceSettingReadAdapter },
    PgWorkspaceStore,
    { provide: WORKSPACE_STORE, useExisting: PgWorkspaceStore },
    PgDocumentStore,
    { provide: DOCUMENT_STORE, useExisting: PgDocumentStore },
    PgShareStore,
    { provide: SHARE_STORE, useExisting: PgShareStore },
    PgSettingStore,
    { provide: SETTING_STORE, useExisting: PgSettingStore },
    PgUploadSessionStore,
    { provide: UPLOAD_SESSION_STORE, useExisting: PgUploadSessionStore },
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
    WorkspaceService,
    WorkspaceSettingService,
    WorkspaceDocumentService,
    WorkspaceDocumentRead,
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
    // Store tokens are exported so modules that instantiate the workspace
    // guards directly (e.g. IndexingModule provides WorkspaceOwnerGuard) can
    // resolve the guards' dependencies.
    WORKSPACE_STORE,
    SHARE_STORE,
  ],
})
export class WorkspaceModule {}
