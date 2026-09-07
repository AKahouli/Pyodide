import { PostgresMessageStore } from './postgres-message-store';

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'a'.repeat(24),
    conversationId: 'b'.repeat(24),
    conversationType: 'user',
    webSearchEnabled: false,
    isEdited: false,
    isStreaming: false,
    isComplete: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('PostgresMessageStore.createUserWithAiPlaceholder', () => {
  function makeHarness(userRow: Record<string, unknown>, placeholderRow: Record<string, unknown>) {
    const returning = jest.fn()
      .mockResolvedValueOnce([userRow])
      .mockResolvedValueOnce([placeholderRow]);
    const insertBuilder = { values: jest.fn().mockReturnValue({ returning }) };
    const updateBuilder = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(undefined),
    };
    const tx = {
      insert: jest.fn().mockReturnValue(insertBuilder),
      update: jest.fn().mockReturnValue(updateBuilder),
    };
    const transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(tx));
    const db = { transaction } as never;
    return { tx, insertBuilder, updateBuilder, returning, transaction, store: new PostgresMessageStore(db) };
  }

  it('persists user, counters, placeholder, and answer linkage in ONE transaction', async () => {
    const userRow = makeRow({ id: 'user-1', conversationType: 'user' });
    const placeholderRow = makeRow({ id: 'placeholder-1', conversationType: 'ai', isStreaming: true, isComplete: false });
    const { tx, insertBuilder, updateBuilder, transaction, store } = makeHarness(userRow, placeholderRow);

    const result = await store.createUserWithAiPlaceholder({
      user: {
        conversationId: 'conv-1',
        senderId: 'sender-1',
        content: 'Question',
        requestId: 'req-1',
      } as never,
      placeholder: {
        conversationId: 'conv-1',
        senderId: 'sender-1',
        requestId: 'req-1',
      } as never,
    });

    // One round trip
    expect(transaction).toHaveBeenCalledTimes(1);
    // Two inserts (user, then placeholder)
    expect(insertBuilder.values).toHaveBeenCalledTimes(2);
    // Conversation counters update + answer linkage update
    expect(updateBuilder.set).toHaveBeenCalledTimes(2);
    expect(updateBuilder.set).toHaveBeenNthCalledWith(1, expect.objectContaining({
      lastMessageAt: expect.any(Date),
      messageCount: expect.anything(),
    }));
    const generatedUserId = (insertBuilder.values.mock.calls[0] as unknown[])[0] as { id: string };
    const generatedPlaceholderId = (insertBuilder.values.mock.calls[1] as unknown[])[0] as { id: string };
    expect(updateBuilder.set).toHaveBeenNthCalledWith(2, expect.objectContaining({
      answerMessageId: generatedPlaceholderId.id,
    }));
    // Placeholder references the user row id written in the same transaction
    expect(insertBuilder.values).toHaveBeenNthCalledWith(2, expect.objectContaining({
      conversationType: 'ai',
      questionMessageId: generatedUserId.id,
    }));
    expect(result.user.id).toBe('user-1');
    expect(result.placeholder.id).toBe('placeholder-1');
    expect(tx).toBeDefined();
  });
});
