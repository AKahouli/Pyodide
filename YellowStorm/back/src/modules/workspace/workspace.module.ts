import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Workspace, WorkspaceSchema } from './schemas/workspace.schema';
import {
  Conversation,
  ConversationSchema,
} from '../conversation/schemas/conversation.schema';
import { Agent, AgentSchema } from '../agent/schemas/agent.schema';
import { Playbook, PlaybookSchema } from '../playbook/schemas/playbook.schema';
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
import { WorkspaceService } from './workspace.service';
import { WorkspaceSettingService } from './workspace-setting.service';
import { WorkspaceDocumentService } from './workspace-document.service';
import { WorkspaceOwnerGuard } from './guards/workspace-owner.guard';
import { AuthModule } from '../auth/auth.module';
import { LoggerModule } from '../logger';
import { DocumentModule } from '../document/document.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsageModule } from '../usage/usage.module';
import { IndexingModule } from '../indexing/indexing.module';
import workspaceConfig from '../../config/workspace.config';

@Module({
  imports: [
    ConfigModule.forFeature(workspaceConfig),
    MongooseModule.forFeature([
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: WorkspaceDoc.name, schema: WorkspaceDocumentSchema },
      { name: WorkspaceSetting.name, schema: WorkspaceSettingSchema },
      { name: UploadSession.name, schema: UploadSessionSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: Playbook.name, schema: PlaybookSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UsageModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => IndexingModule),
    DocumentModule,
    LoggerModule,
  ],
  controllers: [
    WorkspaceController,
    WorkspaceSettingController,
    WorkspaceDocumentController,
    WorkspaceIngestController,
  ],
  providers: [
    WorkspaceService,
    WorkspaceSettingService,
    WorkspaceDocumentService,
    WorkspaceOwnerGuard,
  ],
  exports: [
    WorkspaceService,
    WorkspaceSettingService,
    WorkspaceDocumentService,
  ],
})
export class WorkspaceModule {}
