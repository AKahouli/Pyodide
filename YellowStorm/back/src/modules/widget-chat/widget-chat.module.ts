import { Module } from '@nestjs/common';
import { ConversationModule } from '@modules/conversation/conversation.module';
import { AgentModule } from '@modules/agent/agent.module';
import { ModelsModule } from '@modules/models/models.module';
import { DocumentModule } from '@modules/document/document.module';
import { WorkspaceModule } from '@modules/workspace/workspace.module';
import { LoggerModule } from '@modules/logger';
import { WidgetChatController } from './controllers/widget-chat.controller';
import { AdminWidgetController } from './controllers/admin-widget.controller';
import { AgentIntegrationController } from './controllers/agent-integration.controller';
import { AgentWidgetTokenController } from './controllers/agent-widget-token.controller';
import { WidgetChatService } from './services/widget-chat.service';
import { WidgetTokenGuard } from './guards/widget-token.guard';
import { PgWidgetMessageStore, PgWidgetSessionStore, PgWidgetTokenStore } from './persistence/pg-widget.store';

@Module({
  imports: [
    AgentModule,
    ModelsModule,
    ConversationModule,
    DocumentModule,
    WorkspaceModule,
    LoggerModule,
  ],
  controllers: [
    WidgetChatController,
    AdminWidgetController,
    AgentIntegrationController,
    AgentWidgetTokenController,
  ],
  providers: [
    // Widget cutover (plan 4.12–4.14): PG-backed stores.
    PgWidgetTokenStore,
    PgWidgetSessionStore,
    PgWidgetMessageStore,
    WidgetChatService,
    WidgetTokenGuard,
  ],
  exports: [WidgetChatService],
})
export class WidgetChatModule {}
