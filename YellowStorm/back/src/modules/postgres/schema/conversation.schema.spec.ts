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
});
