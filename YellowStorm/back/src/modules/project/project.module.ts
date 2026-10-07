import { Module, forwardRef } from '@nestjs/common';
import { ConversationPersistenceModule } from '../conversation/persistence/conversation-persistence.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserModule } from '../user/user.module';
import { ProjectController } from './controllers/project.controller';
import { ProjectShareController } from './controllers/project-share.controller';
import { ProjectService } from './project.service';
import { ProjectShareService } from './project-share.service';
import { LoggerModule } from '../logger';
import { PostgresProjectStore } from './persistence/postgres/postgres-project-store';
import { PostgresProjectShareStore } from './persistence/postgres/postgres-project-share-store';

@Module({
  imports: [
    ConversationPersistenceModule,
    forwardRef(() => NotificationsModule),
    UserModule,
    LoggerModule,
  ],
  controllers: [ProjectController, ProjectShareController],
  providers: [
    ProjectService,
    ProjectShareService,
    PostgresProjectStore,
    PostgresProjectShareStore,
  ],
  exports: [ProjectService, ProjectShareService],
})
export class ProjectModule {}
