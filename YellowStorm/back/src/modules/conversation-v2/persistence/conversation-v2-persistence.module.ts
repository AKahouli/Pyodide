import { Module } from '@nestjs/common';
import { PostgresModule } from '@modules/postgres';
import { PgConversationV2SessionStore } from './postgres/pg-conversation-v2-session.store';
import { PgConversationV2EventStore } from './postgres/pg-conversation-v2-event.store';
import { PgConversationV2AppShareStore } from './postgres/pg-conversation-v2-app-share.store';

@Module({
  imports: [PostgresModule],
  providers: [
    PgConversationV2SessionStore,
    PgConversationV2EventStore,
    PgConversationV2AppShareStore,
  ],
  exports: [
    PgConversationV2SessionStore,
    PgConversationV2EventStore,
    PgConversationV2AppShareStore,
  ],
})
export class ConversationV2PersistenceModule {}
