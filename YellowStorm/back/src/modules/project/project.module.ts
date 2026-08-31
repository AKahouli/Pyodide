import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Project, ProjectSchema } from './schemas/project.schema';
import { ConversationPersistenceModule } from '../conversation/persistence/conversation-persistence.module';
import { ProjectController } from './controllers/project.controller';
import { ProjectService } from './project.service';
import { LoggerModule } from '../logger';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Project.name, schema: ProjectSchema }]),
    ConversationPersistenceModule,
    LoggerModule,
  ],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
