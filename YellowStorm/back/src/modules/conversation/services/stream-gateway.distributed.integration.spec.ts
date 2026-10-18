import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Subject, firstValueFrom, filter, take, toArray } from 'rxjs';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { conversations, conversationGroupMembers } from '../../postgres/schema';
import { eq } from 'drizzle-orm';
import { StreamGatewayService } from './stream-gateway.service';
import type { StreamEvent } from '../interfaces/stream.interface';

describeIntegration('classic distributed SSE PostgreSQL', () => {
  const database = makeTestDb();
  const id = () => randomBytes(12).toString('hex');
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const config = { get: (_: string, fallback: unknown) => fallback };
  let a: StreamGatewayService, b: StreamGatewayService;
  let user: string, outsider: string, conversation: string;
  const chunk = (value: number): StreamEvent => ({ type: 'stream_chunk', data: { conversationId: conversation, action: 'add', component: { id: String(value), type: 'text', data: { content: String(value) } } } } as StreamEvent);
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const committed = async (expected = 1) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await database.db.execute(sql`SELECT count(*)::int AS count FROM conversation.sse_events WHERE user_id = ${user}`);
      if (Number(result.rows[0].count) >= expected) return;
      await wait(25);
    }
    throw new Error('SSE producer did not commit within test deadline');
  };
  beforeAll(async () => {
    const exists = await database.pool.query("SELECT to_regclass('conversation.sse_events') AS name");
    if (!exists.rows[0].name) {
      await database.pool.query(readFileSync(join(process.cwd(), 'drizzle/0053_conversation_sse_events.sql'), 'utf8').replace("SET LOCAL lock_timeout = '5s';", ''));
    }
  });
  beforeEach(async () => {
    user = id(); outsider = id(); conversation = id();
    await database.db.insert(conversations).values({ id: conversation, createdBy: user });
    a = new StreamGatewayService(config as never, logger as never, database.db);
    b = new StreamGatewayService(config as never, logger as never, database.db);
    await Promise.all([a.onModuleInit(), b.onModuleInit()]);
  });
  afterEach(async () => {
    a.onModuleDestroy(); b.onModuleDestroy(); await wait(60);
    await database.db.execute(sql`DELETE FROM conversation.sse_events WHERE user_id IN (${user}, ${outsider})`);
    await database.db.delete(conversations).where(eq(conversations.id, conversation));
  });
  afterAll(() => database.close());
  it('delivers A produced events on B in committed order and resumes on A after B closes', async () => {
    const frames = firstValueFrom(b.registerConnection(user, id(), new Subject())!.pipe(filter(f => f.type === 'stream_chunk'), take(3), toArray()));
    a.sendToUser(user, chunk(1)); a.sendToUser(user, chunk(2)); a.sendToUser(user, chunk(3));
    const received = await frames;
    expect(received.map(frame => (frame.data as { component: { id: string } }).component.id)).toEqual(['1', '2', '3']);
    expect(received.map(f => Number(f.id!.split(':')[2]))).toEqual([...received.map(f => Number(f.id!.split(':')[2]))].sort((x, y) => x-y));
    b.onModuleDestroy();
    a.sendToUser(user, chunk(4));
    const resumed = await firstValueFrom(a.registerConnection(user, id(), new Subject(), received[2].id)!.pipe(filter(f => f.type === 'stream_chunk'), take(1)));
    expect((resumed.data as { component: { id: string } }).component.id).toBe('4');
  });
  it('isolates recipient rows and rechecks revoked conversation membership', async () => {
    await database.db.update(conversations).set({ isGroup: true }).where(eq(conversations.id, conversation));
    await database.db.insert(conversationGroupMembers).values({ conversationId: conversation, userId: outsider, position: 0, joinedAt: new Date(), status: 'member' });
    a.sendToUser(outsider, chunk(1)); await wait(150);
    await database.db.delete(conversationGroupMembers).where(eq(conversationGroupMembers.userId, outsider));
    const frames: string[] = [];
    const sub = b.registerConnection(outsider, id(), new Subject())!.subscribe(frame => frames.push(frame.type!));
    a.sendToUser(user, chunk(2)); await wait(500); sub.unsubscribe();
    expect(frames).not.toContain('stream_chunk'); expect(frames).toContain('stream_resync_required');
  });
  it.each([10, 30])('isolates %i simultaneous recipients with ordered multi-conversation streams', async count => {
    const recipients = Array.from({ length: count }, id);
    const additional: string[] = [];
    try {
      const results = recipients.map(recipient => firstValueFrom(b.registerConnection(recipient, id(), new Subject())!
        .pipe(filter(frame => frame.type === 'stream_chunk'), take(3), toArray())));
      for (const recipient of recipients) {
        const conv = id(); additional.push(conv);
        await database.db.insert(conversations).values({ id: conv, createdBy: recipient });
        for (let value = 0; value < 3; value++) {
          a.sendToUser(recipient, { type: 'stream_chunk', data: { conversationId: conv, action: 'add', component: { id: `${recipient}:${value}`, type: 'text', data: { content: recipient } } } } as StreamEvent);
        }
      }
      const deliveries = await Promise.all(results);
      deliveries.forEach((frames, index) => {
        expect(frames.map(frame => (frame.data as { component: { id: string } }).component.id)).toEqual([0, 1, 2].map(value => `${recipients[index]}:${value}`));
      });
    } finally {
      for (const conv of additional) await database.db.delete(conversations).where(eq(conversations.id, conv));
    }
  });
  it('bounds pre-commit publisher loss with canonical resync on a surviving remote pipe', async () => {
    const frames: string[] = [];
    const sub = b.registerConnection(user, id(), new Subject())!.subscribe(frame => frames.push(frame.type!));
    await wait(250);
    const initial = frames.filter(type => type === 'stream_resync_required').length;
    a.sendToUser(user, chunk(1)); a.onModuleDestroy();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000);
    try {
      await wait(350);
      expect(frames.filter(type => type === 'stream_resync_required').length).toBeGreaterThan(initial);
      expect(frames).not.toContain('stream_chunk');
    } finally { clock.mockRestore(); sub.unsubscribe(); }
  });
  it('surfaces failed producer persistence as a durable resync without exposing driver errors', async () => {
    const transaction = jest.spyOn(database.db, 'transaction').mockRejectedValueOnce(new Error('SECRET_DATABASE_CONNECTION'));
    const marker = firstValueFrom(b.registerConnection(user, id(), new Subject())!.pipe(
      filter(frame => frame.type === 'stream_resync_required' && Boolean(frame.id)), take(1)));
    try {
      a.sendToUser(user, chunk(1));
      expect((await marker).type).toBe('stream_resync_required');
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('SECRET_DATABASE_CONNECTION');
    } finally { transaction.mockRestore(); }
  });
  it('withholds deleted and expired payloads after reload', async () => {
    a.sendToUser(user, chunk(1)); await committed();
    await database.db.execute(sql`UPDATE conversation.sse_events SET created_at = now() - interval '5 minutes' WHERE user_id = ${user}`);
    const frames: string[] = [];
    const sub = b.registerConnection(user, id(), new Subject())!.subscribe(frame => frames.push(frame.type!));
    await wait(300); expect(frames).not.toContain('stream_chunk'); sub.unsubscribe();
    a.sendToUser(user, chunk(2)); await wait(150);
    await database.db.delete(conversations).where(eq(conversations.id, conversation));
    const sub2 = b.registerConnection(user, id(), new Subject())!.subscribe(frame => frames.push(frame.type!));
    await wait(300); expect(frames).not.toContain('stream_chunk'); sub2.unsubscribe();
  });
  it('resyncs from a retained overload marker when newer deltas have been pruned', async () => {
    a.onModuleDestroy();
    a = new StreamGatewayService({ get: (key: string, fallback: unknown) => key === 'conversation.sseReplayMaxEvents' ? 3 : fallback } as never, logger as never, database.db);
    const inserted = await database.db.execute(sql`INSERT INTO conversation.sse_events (user_id, event)
      VALUES (${user}, '{"type":"stream_resync_required","data":{"reason":"cursor_gap"}}'::jsonb) RETURNING id::text AS id`);
    for (let index = 0; index < 6; index++) a.sendToUser(user, chunk(index));
    await committed(3);
    const notice = await firstValueFrom(b.registerConnection(user, id(), new Subject(), `pg:1:${inserted.rows[0].id}`)!.pipe(take(1)));
    expect(notice.type).toBe('stream_resync_required');
  });
  it('retains only the newest recovery marker so fresh live data cannot be starved', async () => {
    for (let index = 0; index < 250; index++) a.sendToUser(user, { type: 'stream_resync_required', data: { reason: 'cursor_gap' } });
    a.sendToUser(user, chunk(99));
    const frame = await firstValueFrom(b.registerConnection(user, id(), new Subject())!.pipe(filter(row => row.type === 'stream_chunk'), take(1)));
    expect((frame.data as { component: { id: string } }).component.id).toBe('99');
    const markers = await database.db.execute(sql`SELECT id FROM conversation.sse_events WHERE user_id = ${user} AND event->>'type' = 'stream_resync_required'`);
    expect(markers.rows).toHaveLength(1);
  });
  it('reconnects with resync after pruning and bounds queued events', async () => {
    const received = firstValueFrom(b.registerConnection(user, id(), new Subject())!.pipe(filter(f => f.type === 'stream_chunk'), take(1)));
    a.sendToUser(user, chunk(1)); const first = await received;
    await database.db.execute(sql`DELETE FROM conversation.sse_events WHERE user_id = ${user}`);
    const notice = await firstValueFrom(a.registerConnection(user, id(), new Subject(), first.id)!.pipe(filter(f => f.type === 'stream_resync_required'), take(1)));
    expect(notice.type).toBe('stream_resync_required');
    for (let i = 0; i < 2000; i++) a.sendToUser(user, chunk(i));
    expect((a as unknown as { pending: unknown[] }).pending.length).toBeLessThanOrEqual(1000);
    await wait(600);
    const marker = await database.db.execute(sql`SELECT id FROM conversation.sse_events WHERE user_id = ${user} AND event->>'type' = 'stream_resync_required'`);
    expect(marker.rows.length).toBeGreaterThan(0);
  });
});
