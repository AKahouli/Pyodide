import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  conversationGroupInvites,
  conversationPlaybookHandoffs,
  conversations,
  messages,
  reports,
  sharedConversations,
} from './conversation.schema';

describe('conversation postgres schema', () => {
  it('keeps all owned tables in the conversation schema', () => {
    for (const table of [
      conversations,
      messages,
      reports,
      sharedConversations,
      conversationPlaybookHandoffs,
    ]) {
      expect(getTableConfig(table).schema).toBe('conversation');
    }
  });

  it('preserves weak report references and the share ownership cascade', () => {
    expect(getTableConfig(reports).foreignKeys).toHaveLength(0);
    expect(getTableConfig(sharedConversations).foreignKeys).toHaveLength(1);
  });

  it('does not make normalized invitation emails unique', () => {
    const config = getTableConfig(conversationGroupInvites);
    expect(config.indexes.filter((item) => item.config.unique)).toHaveLength(0);
  });

  it('defines message self-link columns for second-pass backfill', () => {
    expect(messages.questionMessageId).toBeDefined();
    expect(messages.answerMessageId).toBeDefined();
    expect(messages.parentMessageId).toBeDefined();
  });

  it('declares the scalability index inventory without superseded hot-path indexes', () => {
    const names = [
      ...getTableConfig(conversations).indexes,
      ...getTableConfig(messages).indexes,
      ...getTableConfig(reports).indexes,
      ...getTableConfig(sharedConversations).indexes,
    ].map((item) => item.config.name);
    expect(names).toEqual(expect.arrayContaining([
      'idx_conv_owner_ready_last_v2',
      'idx_conv_owner_ready_created_v2',
      'idx_messages_conv_created_v2',
      'idx_messages_pending_reliability_v2',
      'idx_shared_expires_v2',
      'idx_reports_created_v2',
    ]));
    expect(names).not.toContain('idx_conversations_owner_last_message');
    expect(names).not.toContain('idx_messages_conversation_created');
  });
});
