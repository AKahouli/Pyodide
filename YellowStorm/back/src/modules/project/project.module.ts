import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Project, ProjectSchema } from './schemas/project.schema';
import { ProjectShare, ProjectShareSchema } from './schemas/project-share.schema';
import { ConversationPersistenceModule } from '../conversation/persistence/conversation-persistence.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserModule } from '../user/user.module';
import { ProjectController } from './controllers/project.controller';
import { ProjectShareController } from './controllers/project-share.controller';
import { ProjectService } from './project.service';
import { ProjectShareService } from './project-share.service';
import { LoggerModule } from '../logger';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: ProjectShare.name, schema: ProjectShareSchema },
    ]),
    ConversationPersistenceModule,
    forwardRef(() => NotificationsModule),
    UserModule,
    LoggerModule,
  ],
  controllers: [ProjectController, ProjectShareController],
  providers: [ProjectService, ProjectShareService],
  exports: [ProjectService, ProjectShareService],
})
export class ProjectModule {}
