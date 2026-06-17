import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConversationModule } from '@modules/conversation/conversation.module';
import { AgentModule } from '@modules/agent/agent.module';
import { ModelsModule } from '@modules/models/models.module';
import { Agent, AgentSchema } from '@modules/agent/schemas/agent.schema';
import { LoggerModule } from '@modules/logger';
import { WidgetChatController } from './controllers/widget-chat.controller';
import { AdminWidgetController } from './controllers/admin-widget.controller';
import { AgentIntegrationController } from './controllers/agent-integration.controller';
import { AgentWidgetTokenController } from './controllers/agent-widget-token.controller';
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
    ModelsModule,
    ConversationModule,
    LoggerModule,
  ],
  controllers: [
    WidgetChatController,
    AdminWidgetController,
    AgentIntegrationController,
    AgentWidgetTokenController,
  ],
  providers: [WidgetChatService, WidgetTokenGuard],
  exports: [WidgetChatService],
})
export class WidgetChatModule {}
