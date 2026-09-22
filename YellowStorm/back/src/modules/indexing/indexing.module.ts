import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WorkspaceModule } from '../workspace/workspace.module';
import { IndexingService } from './indexing.service';
import { IndexingController } from './indexing.controller';
import { IndexingWebhookController } from './indexing-webhook.controller';
import { CommunityGraphController } from './community-graph.controller';
import { IndexingClientService } from './indexing-client.service';
import { WorkspaceOwnerGuard } from '../workspace/guards/workspace-owner.guard';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LoggerModule } from '../logger';
import indexingConfig from '../../config/indexing.config';
import { IntegrationEventsModule } from '../integration-events/integration-events.module';

@Module({
  imports: [
    forwardRef(() => WorkspaceModule),
    ConfigModule.forFeature(indexingConfig),
    forwardRef(() => AuthModule),
    forwardRef(() => NotificationsModule),
    LoggerModule,
    IntegrationEventsModule,
  ],
  controllers: [IndexingController, IndexingWebhookController, CommunityGraphController],
  providers: [IndexingService, IndexingClientService, WorkspaceOwnerGuard],
  exports: [IndexingService],
})
export class IndexingModule {}
