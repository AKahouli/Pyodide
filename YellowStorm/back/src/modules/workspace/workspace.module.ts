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
import { Agent, AgentSchema } from '../agent/schemas/agent.schema';
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
      { name: Agent.name, schema: AgentSchema },
      { name: Flow.name, schema: FlowSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UsageModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => IndexingModule),
    UserModule,
    DocumentModule,
    LoggerModule,
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
    WorkspaceInitializerService,
    WorkspaceShareService,
    WorkspaceOwnerGuard,
    WorkspaceAccessGuard,
    WritePermissionGuard,
    InternalServiceGuard,
    UrlToPdfClientService,
  ],
  exports: [
    WorkspaceService,
    WorkspaceSettingService,
    WorkspaceDocumentService,
    WorkspaceInitializerService,
    WorkspaceShareService,
  ],
})
export class WorkspaceModule {}
