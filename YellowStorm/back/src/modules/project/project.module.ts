import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Project, ProjectSchema } from './schemas/project.schema';
import {
  Conversation,
  ConversationSchema,
} from '../conversation/schemas/conversation.schema';
import { ProjectController } from './controllers/project.controller';
import { ProjectService } from './project.service';
import { LoggerModule } from '../logger';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: Conversation.name, schema: ConversationSchema },
    ]),
    LoggerModule,
  ],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
