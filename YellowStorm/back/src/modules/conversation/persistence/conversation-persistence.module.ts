import { Module } from '@nestjs/common';
import { PostgresModule } from '@modules/postgres';
import { CONVERSATION_ANALYTICS_STORE } from './conversation-analytics-store';
import { CONVERSATION_BRANCH_STORE } from './conversation-branch-store';
import { CONVERSATION_PLAYBOOK_HANDOFF_STORE } from './conversation-playbook-handoff-store';
import { CONVERSATION_STORE } from './conversation-store';
import { MESSAGE_STORE } from './message-store';
import { PostgresConversationAnalyticsStore } from './postgres/postgres-conversation-analytics-store';
import { PostgresConversationBranchStore } from './postgres/postgres-conversation-branch-store';
import { PostgresConversationExpiryService } from './postgres/postgres-conversation-expiry.service';
import { PostgresConversationPlaybookHandoffStore } from './postgres/postgres-conversation-playbook-handoff-store';
import { PostgresConversationStore } from './postgres/postgres-conversation-store';
import { PostgresMessageStore } from './postgres/postgres-message-store';
import { PostgresReportStore } from './postgres/postgres-report-store';
import { PostgresShareStore } from './postgres/postgres-share-store';
import { REPORT_STORE } from './report-store';
import { SHARE_STORE } from './share-store';

@Module({
  imports: [PostgresModule],
  providers: [
    PostgresConversationStore,
    PostgresMessageStore,
    PostgresConversationBranchStore,
    PostgresConversationExpiryService,
    PostgresConversationPlaybookHandoffStore,
    PostgresReportStore,
    PostgresShareStore,
    PostgresConversationAnalyticsStore,
    { provide: CONVERSATION_STORE, useExisting: PostgresConversationStore },
    { provide: MESSAGE_STORE, useExisting: PostgresMessageStore },
    { provide: CONVERSATION_BRANCH_STORE, useExisting: PostgresConversationBranchStore },
    { provide: REPORT_STORE, useExisting: PostgresReportStore },
    { provide: SHARE_STORE, useExisting: PostgresShareStore },
    {
      provide: CONVERSATION_ANALYTICS_STORE,
      useExisting: PostgresConversationAnalyticsStore,
    },
    {
      provide: CONVERSATION_PLAYBOOK_HANDOFF_STORE,
      useExisting: PostgresConversationPlaybookHandoffStore,
    },
  ],
  exports: [
    CONVERSATION_STORE,
    MESSAGE_STORE,
    CONVERSATION_BRANCH_STORE,
    REPORT_STORE,
    SHARE_STORE,
    CONVERSATION_ANALYTICS_STORE,
    CONVERSATION_PLAYBOOK_HANDOFF_STORE,
  ],
})
export class ConversationPersistenceModule {}
