import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
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

  it('commits admission in four statements while keeping lock and decision snapshots separate', async () => {
    const client = await database.pool.connect();
    const query = jest.spyOn(client, 'query');
    try {
      const connected = new PostgresConversationExecutionStore(drizzle(client) as never, { setContext: jest.fn() } as never);
      expect(await connected.admit(request())).toEqual({ admitted: true });
      const statements = query.mock.calls.map(([statement]) => typeof statement === 'string' ? statement : (statement as { text: string }).text);
      expect(statements).toHaveLength(4);
      expect(statements[0]).toMatch(/^begin$/i);
      expect(statements[1]).toContain('pg_advisory_xact_lock');
      expect(statements[2]).toContain('WITH conflict');
      expect(statements[3]).toMatch(/^commit$/i);
    } finally { query.mockRestore(); client.release(); }
  });

  it('keeps same-session busy precedence even when capacity is exhausted', async () => {
    const first = request();
    expect(await store.admit(first)).toEqual({ admitted: true });
    expect(await store.admit({ ...request(), nativeSessionId: first.nativeSessionId, maxActiveRunsPerUser: 0, maxActiveRunsFleet: 0 }))
      .toEqual({ admitted: false, reason: 'conversation_busy' });
    expect(await store.admit({ ...request(), maxActiveRunsPerUser: 0 }))
      .toEqual({ admitted: false, reason: 'capacity' });
    expect(await store.admit({ ...request(), maxActiveRunsFleet: 0 }))
      .toEqual({ admitted: false, reason: 'capacity' });
  });

  it('excludes expired rows from quota but retains their running-session conflict', async () => {
    const expired = { ...request(), expiresAt: new Date(Date.now() - 60_000) };
    expect(await store.admit(expired)).toEqual({ admitted: true });
    expect(await store.admit({ ...request(), nativeSessionId: expired.nativeSessionId }))
      .toEqual({ admitted: false, reason: 'conversation_busy' });
    expect(await store.admit({ ...request(), maxActiveRunsPerUser: 1 })).toEqual({ admitted: true });
  });

  it('takes a fresh decision snapshot after waiting for another connection to commit', async () => {
    const holder = await database.pool.connect();
    const waiter = await database.pool.connect();
    let pending: ReturnType<PostgresConversationExecutionStore['admit']> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(73124, 1)');
      const { rows: [{ pid }] } = await waiter.query('SELECT pg_backend_pid() AS pid');
      const waitingStore = new PostgresConversationExecutionStore(drizzle(waiter) as never, { setContext: jest.fn() } as never);
      pending = waitingStore.admit(request());
      let blocked = false;
      for (let attempt = 0; attempt < 30 && !blocked; attempt++) {
        const locks = await database.pool.query('SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = $2 AND NOT granted', [pid, 'advisory']);
        blocked = Boolean(locks.rowCount);
      }
      expect(blocked).toBe(true);
      const legacy = request(false);
      await holder.query(`INSERT INTO conversation.conversation_executions
        (id, conversation_id, user_id, message_id, status, expires_at)
        VALUES ($1, $2, $3, $4, 'running', $5)`,
      [legacy.executionId, conversationId, userId, legacy.messageId, legacy.expiresAt]);
      await holder.query('COMMIT');
      expect(await pending).toEqual({ admitted: false, reason: 'conversation_busy' });
    } finally {
      await holder.query('ROLLBACK');
      if (pending) await pending;
      holder.release(); waiter.release();
    }
  });
});

describe('fleet admission transaction settlement', () => {
  it('does not return success before transaction commit and propagates commit failure', async () => {
    let finishCommit!: () => void;
    const commit = new Promise<void>((resolve) => { finishCommit = resolve; });
    const failure = new Error('commit failed');
    const execute = jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ decision: 'admitted' }] });
    const transaction = jest.fn(async (work) => { await work({ execute }); await commit; throw failure; });
    const store = new PostgresConversationExecutionStore({ transaction } as never, { setContext: jest.fn() } as never);
    let settled = false;
    const result = store.admit({ executionId: 'execution', conversationId: 'conversation', userId: 'owner', messageId: 'message',
      ownerReplicaId: 'test', expiresAt: new Date(), maxActiveRunsPerUser: 2, maxActiveRunsFleet: 10 }).finally(() => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);
    finishCommit();
    await expect(result).rejects.toBe(failure);
  });
});
