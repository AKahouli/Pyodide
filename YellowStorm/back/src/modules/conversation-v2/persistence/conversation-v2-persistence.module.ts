import { Module } from '@nestjs/common';
import { PostgresModule } from '@modules/postgres';
import { CONVERSATION_V2_SESSION_STORE } from './conversation-v2-session.store';
import { CONVERSATION_V2_EVENT_STORE } from './conversation-v2-event.store';
import { CONVERSATION_V2_APP_SHARE_STORE } from './conversation-v2-app-share.store';
import {
  CONVERSATION_V2_TEMPLATE_CATEGORY_STORE,
  CONVERSATION_V2_TEMPLATE_STORE,
} from './conversation-v2-template.store';
import { PgConversationV2SessionStore } from './postgres/pg-conversation-v2-session.store';
import { PgConversationV2EventStore } from './postgres/pg-conversation-v2-event.store';
import { PgConversationV2AppShareStore } from './postgres/pg-conversation-v2-app-share.store';
import {
  PgConversationV2TemplateCategoryStore,
  PgConversationV2TemplateStore,
} from './postgres/pg-conversation-v2-template.store';

@Module({
  imports: [PostgresModule],
  providers: [
    PgConversationV2SessionStore,
    PgConversationV2EventStore,
    PgConversationV2AppShareStore,
    PgConversationV2TemplateCategoryStore,
    PgConversationV2TemplateStore,
    { provide: CONVERSATION_V2_SESSION_STORE, useExisting: PgConversationV2SessionStore },
    { provide: CONVERSATION_V2_EVENT_STORE, useExisting: PgConversationV2EventStore },
    { provide: CONVERSATION_V2_APP_SHARE_STORE, useExisting: PgConversationV2AppShareStore },
    {
      provide: CONVERSATION_V2_TEMPLATE_CATEGORY_STORE,
      useExisting: PgConversationV2TemplateCategoryStore,
    },
    { provide: CONVERSATION_V2_TEMPLATE_STORE, useExisting: PgConversationV2TemplateStore },
  ],
  exports: [
    PgConversationV2SessionStore,
    PgConversationV2EventStore,
    PgConversationV2AppShareStore,
    PgConversationV2TemplateCategoryStore,
    PgConversationV2TemplateStore,
    CONVERSATION_V2_SESSION_STORE,
    CONVERSATION_V2_EVENT_STORE,
    CONVERSATION_V2_APP_SHARE_STORE,
    CONVERSATION_V2_TEMPLATE_CATEGORY_STORE,
    CONVERSATION_V2_TEMPLATE_STORE,
  ],
})
export class ConversationV2PersistenceModule {}
