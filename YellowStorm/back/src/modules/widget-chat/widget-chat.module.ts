import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConversationModule } from '@modules/conversation/conversation.module';
import { AgentModule } from '@modules/agent/agent.module';
import { Agent, AgentSchema } from '@modules/agent/schemas/agent.schema';
import { LoggerModule } from '@modules/logger';
import { WidgetChatController } from './controllers/widget-chat.controller';
import { AdminWidgetController } from './controllers/admin-widget.controller';
import { WidgetChatService } from './services/widget-chat.service';
import { WidgetToken, WidgetTokenSchema } from './schemas/widget-token.schema';
import { WidgetSession, WidgetSessionSchema } from './schemas/widget-session.schema';
import { WidgetMessage, WidgetMessageSchema } from './schemas/widget-message.schema';
import { WidgetTokenGuard } from './guards/widget-token.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WidgetToken.name, schema: WidgetTokenSchema },
      { name: WidgetSession.name, schema: WidgetSessionSchema },
      { name: WidgetMessage.name, schema: WidgetMessageSchema },
      { name: Agent.name, schema: AgentSchema },
    ]),
    AgentModule,
    ConversationModule,
    LoggerModule,
  ],
  controllers: [WidgetChatController, AdminWidgetController],
  providers: [WidgetChatService, WidgetTokenGuard],
  exports: [WidgetChatService],
})
export class WidgetChatModule {}
