import { Module, forwardRef } from '@nestjs/common';
import { ConversationPersistenceModule } from '../conversation/persistence/conversation-persistence.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserModule } from '../user/user.module';
import { ProjectController } from './controllers/project.controller';
import { ProjectShareController } from './controllers/project-share.controller';
import { ProjectService } from './project.service';
import { ProjectShareService } from './project-share.service';
import { LoggerModule } from '../logger';
import { PROJECT_STORE } from './persistence/project-store';
import { PROJECT_SHARE_STORE } from './persistence/project-share-store';
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
    { provide: PROJECT_STORE, useClass: PostgresProjectStore },
    { provide: PROJECT_SHARE_STORE, useClass: PostgresProjectShareStore },
  ],
  exports: [ProjectService, ProjectShareService],
})
export class ProjectModule {}
