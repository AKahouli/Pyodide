import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { WorkspaceDoc, WorkspaceDocumentSchema } from '../workspace/schemas/workspace-document.schema';
import { Workspace, WorkspaceSchema } from '../workspace/schemas/workspace.schema';
import { WorkspaceSetting, WorkspaceSettingSchema } from '../workspace/schemas/workspace-setting.schema';
import { IndexingService } from './indexing.service';
import { IndexingController } from './indexing.controller';
import { IndexingInternalController } from './indexing-internal.controller';
import { IndexingWebhookController } from './indexing-webhook.controller';
import { IndexingClientService } from './indexing-client.service';
import { WorkspaceOwnerGuard } from '../workspace/guards/workspace-owner.guard';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LoggerModule } from '../logger';
import indexingConfig from '../../config/indexing.config';

@Module({
  imports: [
    ConfigModule.forFeature(indexingConfig),
    MongooseModule.forFeature([
      { name: WorkspaceDoc.name, schema: WorkspaceDocumentSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: WorkspaceSetting.name, schema: WorkspaceSettingSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => NotificationsModule),
    LoggerModule,
  ],
  controllers: [IndexingController, IndexingInternalController, IndexingWebhookController],
  providers: [IndexingService, IndexingClientService, WorkspaceOwnerGuard],
  exports: [IndexingService],
})
export class IndexingModule {}
