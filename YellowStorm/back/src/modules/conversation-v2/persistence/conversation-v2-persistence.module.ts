import { Module } from '@nestjs/common';
import { PostgresModule } from '@modules/postgres';
import { SYSTEM_REVISION_SOURCE } from '@modules/app-runtime/ports/system-revision-source.port';
import {
  CONVERSATION_V2_TEMPLATE_CATEGORY_STORE,
  CONVERSATION_V2_TEMPLATE_STORE,
} from './conversation-v2-template.store';
import { ConversationV2TemplateRevisionSource } from './conversation-v2-template-revision.source';
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
    ConversationV2TemplateRevisionSource,
    {
      provide: CONVERSATION_V2_TEMPLATE_CATEGORY_STORE,
      useExisting: PgConversationV2TemplateCategoryStore,
    },
    { provide: CONVERSATION_V2_TEMPLATE_STORE, useExisting: PgConversationV2TemplateStore },
    { provide: SYSTEM_REVISION_SOURCE, useExisting: ConversationV2TemplateRevisionSource },
  ],
  exports: [
    PgConversationV2SessionStore,
    PgConversationV2EventStore,
    PgConversationV2AppShareStore,
    PgConversationV2TemplateCategoryStore,
    PgConversationV2TemplateStore,
    CONVERSATION_V2_TEMPLATE_CATEGORY_STORE,
    CONVERSATION_V2_TEMPLATE_STORE,
    SYSTEM_REVISION_SOURCE,
  ],
})
export class ConversationV2PersistenceModule {}
