import { Module } from '@nestjs/common';
import { PostgresModule } from '@modules/postgres';
import { CONVERSATION_ANALYTICS_STORE } from './conversation-analytics-store';
import { CONVERSATION_STORE } from './conversation-store';
import { ROOT_WORK_STORE } from '@modules/conversation/root-work/root-work.store';
import { PostgresConversationAnalyticsStore } from './postgres/postgres-conversation-analytics-store';
import { PostgresConversationBranchStore } from './postgres/postgres-conversation-branch-store';
import { PostgresConversationExpiryService } from './postgres/postgres-conversation-expiry.service';
import { PostgresConversationExecutionStore } from './postgres/postgres-conversation-execution-store';
import { PostgresConversationPlaybookHandoffStore } from './postgres/postgres-conversation-playbook-handoff-store';
import { PostgresConversationStore } from './postgres/postgres-conversation-store';
import { PostgresMessageStore } from './postgres/postgres-message-store';
import { PostgresReportStore } from './postgres/postgres-report-store';
import { PostgresRootWorkStore } from './postgres/postgres-root-work.store';
import { PostgresShareStore } from './postgres/postgres-share-store';

@Module({
  imports: [PostgresModule],
  providers: [
    PostgresConversationStore,
    PostgresMessageStore,
    PostgresConversationBranchStore,
    PostgresConversationExpiryService,
    PostgresConversationExecutionStore,
    PostgresConversationPlaybookHandoffStore,
    PostgresReportStore,
    PostgresShareStore,
    PostgresConversationAnalyticsStore,
    PostgresRootWorkStore,
    { provide: CONVERSATION_STORE, useExisting: PostgresConversationStore },
    {
      provide: CONVERSATION_ANALYTICS_STORE,
      useExisting: PostgresConversationAnalyticsStore,
    },
    { provide: ROOT_WORK_STORE, useExisting: PostgresRootWorkStore },
  ],
  exports: [
    PostgresConversationStore,
    PostgresMessageStore,
    PostgresConversationBranchStore,
    PostgresConversationExpiryService,
    PostgresConversationExecutionStore,
    PostgresConversationPlaybookHandoffStore,
    PostgresReportStore,
    PostgresShareStore,
    PostgresConversationAnalyticsStore,
    PostgresRootWorkStore,
    ROOT_WORK_STORE,
    CONVERSATION_STORE,
    CONVERSATION_ANALYTICS_STORE,
  ],
})
export class ConversationPersistenceModule {}
