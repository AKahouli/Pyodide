import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { conversations, conversationExecutions } from '../../../postgres/schema';
import { PostgresConversationExecutionStore } from './postgres-conversation-execution-store';
import type { AdmitExecutionInput } from '../conversation-execution-store';

describeIntegration('isolated foreground admission', () => {
  const database = makeTestDb();
  const store = new PostgresConversationExecutionStore(database.db, { setContext: jest.fn(), error: jest.fn() } as never);
  const id = () => randomBytes(12).toString('hex');
  let conversationId: string, userId: string;
  beforeEach(async () => {
    conversationId = id(); userId = id();
    await database.db.insert(conversations).values({ id: conversationId, createdBy: userId });
  });
  afterEach(async () => { await database.db.delete(conversations).where(eq(conversations.id, conversationId)); });
  afterAll(() => database.close());
  const request = (isolated = true): AdmitExecutionInput => {
    const messageId = id();
    return { executionId: id(), conversationId, userId, messageId, ownerReplicaId: 'test',
      ...(isolated ? { nativeSessionId: `turn_${messageId}` } : {}),
      expiresAt: new Date(Date.now() + 60_000), maxActiveRunsPerUser: 2, maxActiveRunsFleet: 10_000 };
  };

  it('admits exactly two simultaneous turns in one conversation and counts both against quota', async () => {
    const results = await Promise.all([store.admit(request()), store.admit(request()), store.admit(request())]);
    expect(results.filter((result) => result.admitted)).toHaveLength(2);
    expect(results).toContainEqual({ admitted: false, reason: 'capacity' });
  });
  it('retains message identity uniqueness across isolated session names', async () => {
    const first = request();
    expect(await store.admit(first)).toEqual({ admitted: true });
    expect(await store.admit({ ...first, executionId: id(), nativeSessionId: 'different' }))
      .toEqual({ admitted: false, reason: 'message_already_running' });
  });
  it('keeps legacy running rows exclusive and permits isolation after they settle', async () => {
    const legacy = request(false);
    await database.db.insert(conversationExecutions).values({ id: legacy.executionId, conversationId, userId,
      messageId: legacy.messageId, status: 'running', expiresAt: legacy.expiresAt });
    expect(await store.admit(request())).toEqual({ admitted: false, reason: 'conversation_busy' });
    await database.db.update(conversationExecutions).set({ status: 'completed' }).where(eq(conversationExecutions.id, legacy.executionId));
    expect(await store.admit(request())).toEqual({ admitted: true });
    expect(await store.admit(request(false))).toEqual({ admitted: false, reason: 'conversation_busy' });
  });
  it('database guard also rejects a legacy writer bypassing application admission', async () => {
    await store.admit(request());
    const legacy = request(false);
    await expect(database.db.execute(sql`INSERT INTO conversation.conversation_executions
      (id, conversation_id, user_id, message_id, expires_at) VALUES
      (${legacy.executionId}, ${conversationId}, ${userId}, ${legacy.messageId}, now())`)).rejects.toThrow();
  });
});
