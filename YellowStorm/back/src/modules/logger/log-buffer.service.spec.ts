import { eq, sql } from 'drizzle-orm';
import { withTransaction } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';
import { LogBufferService } from './log-buffer.service';
import { LogLevelEnum } from './interfaces/log-level.enum';

const ENV = 'log-spec';

describeIntegration('LogBufferService on ops.logs (integration)', () => {
  const { db, close } = makeTestDb();
  const config = (over: Record<string, unknown> = {}) => ({
    get: (key: string, fallback?: unknown) => ({ 'logging.buffer.maxSize': 100000, 'logging.buffer.flushIntervalMs': 3_600_000, 'app.nodeEnv': ENV, ...over })[key] ?? fallback,
  });
  const service = (over: Record<string, unknown> = {}, resolvable = true): LogBufferService => {
    const moduleRef = { get: () => { if (!resolvable) throw new Error('DRIZZLE_DB is not available yet'); return db; } };
    return new LogBufferService(config(over) as never, moduleRef as never);
  };
  const at = (iso: string): string => new Date(iso).toISOString();
  const query = { nodeEnv: ENV, limit: 1000 } as const;

  const services: LogBufferService[] = [];
  const make = (over: Record<string, unknown> = {}, resolvable = true): LogBufferService => {
    const created = service(over, resolvable);
    services.push(created);
    return created;
  };

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM ops.logs WHERE node_env = ${ENV}`);
  });
  afterAll(async () => {
    await db.execute(sql`DELETE FROM ops.logs WHERE node_env = ${ENV}`);
    // Stops each service's flush timer.
    await Promise.all(services.map((s) => s.onModuleDestroy()));
    await close();
  });

  describe('persisting', () => {
    it('writes the buffered entries with their own time as created_at, and empties the buffer', async () => {
      const buffer = make();
      buffer.add({ timestamp: at('2026-09-20T10:00:00Z'), level: 'ERROR', context: 'Billing', message: 'card declined', data: { orderId: 7, tags: ['a'] }, traceId: 't-1', requestId: 'r-1' });
      buffer.add({ timestamp: at('2026-09-20T10:00:01Z'), level: 'INFO', message: 'no context' });
      expect(buffer.getBufferSize()).toBe(2);

      await buffer.flush();

      expect(buffer.getBufferSize()).toBe(0);
      const stored = await db.select().from(schema.opsLogs).where(eq(schema.opsLogs.nodeEnv, ENV));
      expect(stored).toHaveLength(2);
      const byMessage = new Map(stored.map((row) => [row.message, row]));
      expect(byMessage.get('card declined')).toMatchObject({ level: 'ERROR', context: 'Billing', data: { orderId: 7, tags: ['a'] }, traceId: 't-1', requestId: 'r-1', timestamp: at('2026-09-20T10:00:00Z') });
      expect(byMessage.get('card declined')!.createdAt.toISOString()).toBe('2026-09-20T10:00:00.000Z');
      expect(byMessage.get('no context')).toMatchObject({ context: null, data: null, traceId: null, requestId: null });
      expect(byMessage.get('no context')!.id).toMatch(/^[0-9a-f]{24}$/);
    });

    it('keeps the whole batch when one entry holds U+0000, a BigInt or a circular structure', async () => {
      const buffer = make();
      const circular: Record<string, unknown> = { name: 'loop' };
      circular.self = circular;
      buffer.add({ timestamp: at('2026-09-20T11:00:00Z'), level: 'WARN', context: 'Ctx\u0000', message: 'bad\u0000text', data: { text: 'a\u0000b', big: 12345678901234567890n } });
      buffer.add({ timestamp: at('2026-09-20T11:00:01Z'), level: 'WARN', message: 'circular', data: circular });
      buffer.add({ timestamp: at('2026-09-20T11:00:02Z'), level: 'WARN', message: 'plain' });

      await buffer.flush();

      const found = (await buffer.findLogs({ ...query, sort: 'asc' })).data;
      expect(found.map((e) => e.message)).toEqual(['badtext', 'circular', 'plain']);
      expect(found[0]).toMatchObject({ context: 'Ctx', data: { text: 'ab', big: '12345678901234567890' } });
      expect(found[1].data).toEqual({ unserializable: true });
    });

    it('stamps an entry whose timestamp cannot be read with the current time', async () => {
      const buffer = make();
      buffer.add({ timestamp: 'not a date', level: 'INFO', message: 'odd stamp' });
      await buffer.flush();

      const [row] = await db.select().from(schema.opsLogs).where(eq(schema.opsLogs.nodeEnv, ENV));
      expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
      expect(row.timestamp).toBe('not a date');
    });

    it('does not throw when the database refuses an entry, and keeps accepting new ones', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const buffer = make();
        buffer.add({ timestamp: at('2026-09-20T12:00:00Z'), level: 'SHOUT', message: 'unknown level' });
        await expect(buffer.flush()).resolves.toBeUndefined();
        expect(spy).toHaveBeenCalledWith('[LogBufferService] Failed to persist logs:', expect.any(String));

        buffer.add({ timestamp: at('2026-09-20T12:00:01Z'), level: 'INFO', message: 'still works' });
        await buffer.flush();
        expect((await buffer.findLogs(query)).data.map((e) => e.message)).toEqual(['still works']);
      } finally {
        spy.mockRestore();
      }
    });

    it('is not undone by a caller that rolls back: the logs explaining a failure survive it', async () => {
      const buffer = make();
      await expect(withTransaction(db, async () => {
        buffer.add({ timestamp: at('2026-09-20T13:00:00Z'), level: 'ERROR', message: 'about to fail' });
        await buffer.flush();
        throw new Error('request failed');
      })).rejects.toThrow('request failed');

      expect((await buffer.findLogs(query)).data.map((e) => e.message)).toEqual(['about to fail']);
    });

    it('holds the entries while the database is not reachable yet, and writes them once it is', async () => {
      let ready = false;
      const moduleRef = { get: () => { if (!ready) throw new Error('not yet'); return db; } };
      const buffer = new LogBufferService(config() as never, moduleRef as never);
      services.push(buffer);
      buffer.add({ timestamp: at('2026-09-20T14:00:00Z'), level: 'INFO', message: 'early bird' });

      await buffer.flush();
      expect(buffer.getBufferSize()).toBe(1);
      expect((await buffer.findLogs(query)).data.map((e) => e.message)).toEqual(['early bird']);

      ready = true;
      await buffer.flush();
      expect(buffer.getBufferSize()).toBe(0);
      expect((await db.select().from(schema.opsLogs).where(eq(schema.opsLogs.nodeEnv, ENV)))).toHaveLength(1);
    });

    it('drops the buffer without touching the database when persistence is switched off', async () => {
      const buffer = make({ 'logging.persistenceEnabled': false });
      buffer.add({ timestamp: at('2026-09-20T15:00:00Z'), level: 'INFO', message: 'not saved' });
      await buffer.flush();

      expect(buffer.getBufferSize()).toBe(0);
      expect(await db.select().from(schema.opsLogs).where(eq(schema.opsLogs.nodeEnv, ENV))).toEqual([]);
    });
  });

  describe('querying', () => {
    const seed = async (buffer: LogBufferService) => {
      const entries = [
        { timestamp: at('2026-09-21T09:00:00Z'), level: 'ERROR', context: 'AuthService', message: 'login failed (bad password)', requestId: 'req-1', traceId: 'tr-1' },
        { timestamp: at('2026-09-21T09:01:00Z'), level: 'WARN', context: 'AuthService', message: '100% sure_thing', requestId: 'req-2' },
        { timestamp: at('2026-09-21T09:02:00Z'), level: 'INFO', context: 'billing.invoice', message: 'invoice issued' },
        { timestamp: at('2026-09-21T09:03:00Z'), level: 'INFO', context: 'BillingService', message: 'Invoice paid' },
        { timestamp: at('2026-09-21T09:04:00Z'), level: 'DEBUG', message: 'no context here' },
      ];
      entries.forEach((entry) => { buffer.add(entry); });
      await buffer.flush();
    };
    const messages = async (buffer: LogBufferService, filters: Record<string, unknown>) =>
      (await buffer.findLogs({ ...query, sort: 'asc', ...filters } as never)).data.map((e) => e.message);

    it('filters by level, context (exact, wildcard, anchored), message, time and ids', async () => {
      const buffer = make();
      await seed(buffer);

      expect(await messages(buffer, { level: LogLevelEnum.ERROR })).toEqual(['login failed (bad password)']);
      expect(await messages(buffer, { level: [LogLevelEnum.ERROR, LogLevelEnum.WARN] })).toHaveLength(2);
      expect(await messages(buffer, { level: [] })).toEqual([]);

      expect(await messages(buffer, { context: 'AuthService' })).toHaveLength(2);
      expect(await messages(buffer, { context: 'authservice' })).toEqual([]); // exact is case-sensitive
      expect(await messages(buffer, { context: '*billing*' })).toEqual(['invoice issued', 'Invoice paid']);
      expect(await messages(buffer, { context: 'billing.*' })).toEqual(['invoice issued']); // the dot is literal
      expect(await messages(buffer, { context: '^Billing' })).toEqual(['invoice issued', 'Invoice paid']); // a pattern ignores case
      expect(await messages(buffer, { context: '^billingS*' })).toEqual(['Invoice paid']);
      expect(await messages(buffer, { context: '^illing' })).toEqual([]);

      // Literal and case-insensitive: parentheses, % and _ are not special.
      expect(await messages(buffer, { message: '(bad' })).toEqual(['login failed (bad password)']);
      expect(await messages(buffer, { message: '100% sure_' })).toEqual(['100% sure_thing']);
      expect(await messages(buffer, { message: '_' })).toEqual(['100% sure_thing']);
      expect(await messages(buffer, { message: 'INVOICE' })).toEqual(['invoice issued', 'Invoice paid']);

      expect(await messages(buffer, { from: '2026-09-21T09:01:00Z', to: '2026-09-21T09:03:00Z' })).toHaveLength(3);
      expect(await messages(buffer, { from: 'garbage' })).toHaveLength(5);
      expect(await messages(buffer, { requestId: 'req-2' })).toEqual(['100% sure_thing']);
      expect(await messages(buffer, { traceId: 'tr-1' })).toEqual(['login failed (bad password)']);
      expect(await messages(buffer, { hostname: 'nobody' })).toEqual([]);
    });

    it('applies the same filters to entries that are still in the buffer', async () => {
      const buffer = make();
      buffer.add({ timestamp: at('2026-09-22T09:00:00Z'), level: 'ERROR', context: 'billing.invoice', message: 'call(fn) failed' });
      buffer.add({ timestamp: at('2026-09-22T09:01:00Z'), level: 'INFO', context: 'BillingService', message: 'ok' });

      expect(await messages(buffer, { context: '*billing*' })).toEqual(['call(fn) failed', 'ok']);
      expect(await messages(buffer, { context: 'billing.*' })).toEqual(['call(fn) failed']);
      expect(await messages(buffer, { context: '^BillingS*' })).toEqual(['ok']);
      expect(await messages(buffer, { context: '^illing' })).toEqual([]);
      expect(await messages(buffer, { message: '(fn)' })).toEqual(['call(fn) failed']); // a bare "(" used to throw on the buffer path
      expect(await messages(buffer, { message: '(' })).toEqual(['call(fn) failed']);
      expect(await messages(buffer, { level: [LogLevelEnum.INFO] })).toEqual(['ok']);
    });

    it('pages across the database and the buffer, buffer first when newest first', async () => {
      const buffer = make();
      for (let i = 0; i < 3; i += 1) buffer.add({ timestamp: at(`2026-09-23T09:0${i}:00Z`), level: 'INFO', message: `db-${i}` });
      await buffer.flush();
      for (let i = 0; i < 2; i += 1) buffer.add({ timestamp: at(`2026-09-23T10:0${i}:00Z`), level: 'INFO', message: `buf-${i}` });

      const page = async (n: number, sort: 'asc' | 'desc') => (await buffer.findLogs({ nodeEnv: ENV, page: n, limit: 2, sort })).data.map((e) => e.message);
      expect(await page(1, 'desc')).toEqual(['buf-1', 'buf-0']);
      expect(await page(2, 'desc')).toEqual(['db-2', 'db-1']);
      expect(await page(3, 'desc')).toEqual(['db-0']);
      expect(await page(1, 'asc')).toEqual(['db-0', 'db-1']);
      expect(await page(2, 'asc')).toEqual(['db-2', 'buf-0']);
      expect(await page(3, 'asc')).toEqual(['buf-1']);

      const first = await buffer.findLogs({ nodeEnv: ENV, page: 2, limit: 2, sort: 'desc' });
      expect(first.pagination).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3, hasNext: true, hasPrev: true });
      expect(first.data.map((e) => e._fromBuffer)).toEqual([false, false]);
    });

    it('reports distinct values and level counts over the database and the buffer', async () => {
      const buffer = make();
      await seed(buffer);
      buffer.add({ timestamp: at('2026-09-21T10:00:00Z'), level: 'ERROR', context: 'ZetaService', message: 'late' });

      expect(await buffer.getDistinctValues('context', { nodeEnv: ENV })).toEqual(['AuthService', 'billing.invoice', 'BillingService', 'ZetaService']);
      expect(await buffer.getDistinctValues('level', { nodeEnv: ENV })).toEqual(['DEBUG', 'ERROR', 'INFO', 'WARN']);
      expect(await buffer.getDistinctValues('nodeEnv', { nodeEnv: ENV })).toEqual([ENV]);
      expect(await buffer.getCountsByLevel({ nodeEnv: ENV })).toEqual({ ERROR: 2, WARN: 1, INFO: 2, DEBUG: 1 });
    });

    it('finds one persisted entry by id, omitting the fields it does not have', async () => {
      const buffer = make();
      await seed(buffer);
      const [any] = (await buffer.findLogs({ ...query, message: 'no context' })).data;

      const found = await buffer.findLogById(any._id!);
      expect(found).toMatchObject({ _id: any._id, message: 'no context here', level: 'DEBUG', _fromBuffer: false });
      expect(found).not.toHaveProperty('context');
      expect(found).not.toHaveProperty('data');
      expect(await buffer.findLogById(any._id!.toUpperCase())).not.toBeNull();
      expect(await buffer.findLogById('507f1f77bcf86cd799439011')).toBeNull();
      expect(await buffer.findLogById('not-an-id')).toBeNull();
    });

    it('answers from the buffer alone when the database is not available', async () => {
      const buffer = make({}, false);
      buffer.add({ timestamp: at('2026-09-24T09:00:00Z'), level: 'INFO', message: 'only here' });

      expect((await buffer.findLogs(query)).data.map((e) => e.message)).toEqual(['only here']);
      expect(await buffer.getCountsByLevel()).toEqual({ INFO: 1 });
      expect(await buffer.findLogById('507f1f77bcf86cd799439011')).toBeNull();
    });
  });
});
