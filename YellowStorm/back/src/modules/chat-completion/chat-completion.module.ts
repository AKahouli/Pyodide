import { Module } from '@nestjs/common';
import { ChatCompletionService } from './chat-completion.service';
import { AdminChatCompletionController } from './admin-chat-completion.controller';
import { ModelsModule } from '../models/models.module';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [ModelsModule, AuthorizationModule],
  controllers: [AdminChatCompletionController],
  providers: [ChatCompletionService],
  exports: [ChatCompletionService],
})
export class ChatCompletionModule {}
