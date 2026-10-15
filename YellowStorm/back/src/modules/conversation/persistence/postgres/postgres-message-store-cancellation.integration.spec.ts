import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { conversations, messages, conversationExecutions } from '../../../postgres/schema';
import { PostgresMessageStore } from './postgres-message-store';
import { PostgresConversationExecutionStore } from './postgres-conversation-execution-store';

describeIntegration('cancelled foreground persistence', () => {
  const database = makeTestDb();
  const store = new PostgresMessageStore(database.db);
  const admission = new PostgresConversationExecutionStore(database.db, { setContext: jest.fn() } as never);
  const id = () => randomBytes(12).toString('hex');
  let conversationId: string;
  afterEach(async () => { await database.db.delete(conversations).where(eq(conversations.id, conversationId)); });
  afterAll(() => database.close());
  it('retains a checkpoint on expired ownership and rejects late owner writes', async () => {
    conversationId = id(); const actor = id(), answer = id(), lease = randomUUID();
    await database.db.insert(conversations).values({ id: conversationId, createdBy: actor });
    await database.db.insert(messages).values({ id: answer, conversationId, conversationType: 'ai',
      isStreaming: true, isComplete: false, executionStatus: 'running', streamExecutionLeaseId: lease });
    const components = [{ id: 'partial', type: 'text' as const, data: { content: 'Durable partial answer' } }];
    expect(await store.renewStream(answer, lease, new Date(Date.now() - 1000), components)).toBe(true);
    expect(await store.markExecutionInterrupted(answer, 'lease_expired', new Date())).not.toBeNull();
    expect(await store.renewStream(answer, lease, new Date(Date.now() + 60_000), [])).toBe(false);
    expect(await store.markExecutionInterrupted(answer, 'lease_expired', new Date())).toBeNull();
    const [row] = await database.db.select().from(messages).where(eq(messages.id, answer));
    expect(row).toMatchObject({ isComplete: false, isStreaming: false, executionStatus: 'interrupted' });
    expect(row.components).toEqual([components[0], expect.objectContaining({ type: 'error', data: expect.objectContaining({ reason: 'interrupted' }) })]);
  });
  it('retains partial content with cancelled status and leaves a sibling running', async () => {
    conversationId = id(); const actor = id(), first = id(), second = id(), lease = randomUUID();
    await database.db.insert(conversations).values({ id: conversationId, createdBy: actor });
    await database.db.insert(messages).values([first, second].map((messageId) => ({ id: messageId,
      conversationId, conversationType: 'ai' as const, isStreaming: true, isComplete: false,
      executionStatus: 'running', streamExecutionLeaseId: lease })));
    await database.db.insert(conversationExecutions).values([first, second].map((messageId) => ({ id: id(), conversationId,
      userId: actor, messageId, nativeSessionId: `turn_${messageId}`, status: 'running', expiresAt: new Date(Date.now() + 60_000) })));
    const components = [{ id: 'partial', type: 'text' as const, data: { content: 'Partial answer' } }];
    await store.completeAi({ messageId: first, streamExecutionLeaseId: lease, components, terminalStatus: 'cancelled' });
    await admission.finalizeByMessage(first);
    const rows = await database.db.select().from(messages).where(eq(messages.conversationId, conversationId));
    expect(rows.find((row) => row.id === first)).toMatchObject({ isComplete: true, isStreaming: false, executionStatus: 'cancelled', components });
    expect(rows.find((row) => row.id === second)).toMatchObject({ isComplete: false, isStreaming: true, executionStatus: 'running' });
    const executions = await database.db.select().from(conversationExecutions).where(eq(conversationExecutions.conversationId, conversationId));
    expect(executions.find((row) => row.messageId === first)?.status).toBe('cancelled');
    expect(executions.find((row) => row.messageId === second)?.status).toBe('running');
  });
});
