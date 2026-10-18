import { PostgresConversationExecutionStore } from './postgres-conversation-execution-store';

const input = { executionId: 'execution', conversationId: 'conversation', userId: 'user', messageId: 'message',
  ownerReplicaId: 'replica', expiresAt: new Date(), maxActiveRunsPerUser: 2, maxActiveRunsFleet: 10 };

describe('execution store dependency failures', () => {
  it.each(['42P01', 'ECONNRESET', '57014', '53300'])('propagates %s for every control operation and recovers on the next request', async (code) => {
    const failure = Object.assign(new Error('database unavailable'), { code });
    const execute = jest.fn().mockRejectedValue(failure);
    const transaction = jest.fn().mockRejectedValue(failure);
    const store = new PostgresConversationExecutionStore({ execute, transaction } as never, { setContext: jest.fn() } as never);
    await expect(store.onModuleInit()).rejects.toBe(failure);
    await expect(store.admit(input)).rejects.toBe(failure);
    await expect(store.extendExpiry('message', new Date())).rejects.toBe(failure);
    await expect(store.isCancelRequested('message')).rejects.toBe(failure);
    await expect(store.requestCancel({ conversationId: 'conversation', messageId: 'message' })).rejects.toBe(failure);
    await expect(store.finalizeByMessage('message')).rejects.toBe(failure);
    await expect(store.finalizeExpired(new Date())).rejects.toBe(failure);
    execute.mockResolvedValue({ rowCount: 1 });
    await expect(store.requestCancel({ conversationId: 'conversation', messageId: 'message' })).resolves.toBe(true);
  });
});
