import { sql } from 'drizzle-orm';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';
import { OpsLogsService } from './ops-logs.service';
import { LogLevelEnum } from './interfaces/log-level.enum';

const ENV = 'log-spec';

describeIntegration('OpsLogsService over historic ops.logs (integration)', () => {
  const { db, close } = makeTestDb();
  const service = (resolvable = true): OpsLogsService => {
    const moduleRef = { get: () => { if (!resolvable) throw new Error('DRIZZLE_DB is not available yet'); return db; } };
    return new OpsLogsService({ get: () => undefined } as never, moduleRef as never);
  };
  const at = (iso: string): string => new Date(iso).toISOString();
  const query = { nodeEnv: ENV, limit: 1000 } as const;

  /** Direct SQL seed: the SQL write path was retired in P11, so tests insert rows directly. */
  const seed = async (rows: Array<Record<string, unknown>>) => {
    for (const row of rows) {
      await db.insert(schema.opsLogs).values({
        id: (row.id as string) ?? newObjectId(),
        timestamp: row.timestamp as string,
        level: row.level as string,
        context: (row.context as string | undefined) ?? null,
        message: row.message as string,
        data: (row.data as Record<string, unknown> | undefined) ?? null,
        traceId: (row.traceId as string | undefined) ?? null,
        requestId: (row.requestId as string | undefined) ?? null,
        hostname: (row.hostname as string | undefined) ?? null,
        nodeEnv: ENV,
        createdAt: new Date(row.timestamp as string),
      });
    }
  };
  const seedStandard = async () => {
    await seed([
      { timestamp: at('2026-09-21T09:00:00Z'), level: 'ERROR', context: 'AuthService', message: 'login failed (bad password)', requestId: 'req-1', traceId: 'tr-1' },
      { timestamp: at('2026-09-21T09:01:00Z'), level: 'WARN', context: 'AuthService', message: '100% sure_thing', requestId: 'req-2' },
      { timestamp: at('2026-09-21T09:02:00Z'), level: 'INFO', context: 'billing.invoice', message: 'invoice issued' },
      { timestamp: at('2026-09-21T09:03:00Z'), level: 'INFO', context: 'BillingService', message: 'Invoice paid' },
      { timestamp: at('2026-09-21T09:04:00Z'), level: 'DEBUG', message: 'no context here' },
    ]);
  };
  const messages = async (svc: OpsLogsService, filters: Record<string, unknown>) =>
    (await svc.findLogs({ ...query, sort: 'asc', ...filters } as never)).data.map((e) => e.message);

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM ops.logs WHERE node_env = ${ENV}`);
  });
  afterAll(async () => {
    await db.execute(sql`DELETE FROM ops.logs WHERE node_env = ${ENV}`);
    await close();
  });

  it('answers from the database alone when it is not reachable yet', async () => {
    const svc = service(false);
    expect(await svc.findLogs(query)).toEqual({
      data: [],
      pagination: { page: 1, limit: 1000, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    });
    expect(await svc.getCountsByLevel()).toEqual({});
    expect(await svc.getDistinctValues('level')).toEqual([]);
    expect(await svc.findLogById('507f1f77bcf86cd799439011')).toBeNull();
  });

  it('filters by level, context (exact, wildcard, anchored), message, time and ids', async () => {
    const svc = service();
    await seedStandard();

    expect(await messages(svc, { level: LogLevelEnum.ERROR })).toEqual(['login failed (bad password)']);
    expect(await messages(svc, { level: [LogLevelEnum.ERROR, LogLevelEnum.WARN] })).toHaveLength(2);
    expect(await messages(svc, { level: [] })).toEqual([]);

    expect(await messages(svc, { context: 'AuthService' })).toHaveLength(2);
    expect(await messages(svc, { context: 'authservice' })).toEqual([]); // exact is case-sensitive
    expect(await messages(svc, { context: '*billing*' })).toEqual(['invoice issued', 'Invoice paid']);
    expect(await messages(svc, { context: 'billing.*' })).toEqual(['invoice issued']); // the dot is literal
    expect(await messages(svc, { context: '^Billing' })).toEqual(['invoice issued', 'Invoice paid']); // a pattern ignores case
    expect(await messages(svc, { context: '^billingS*' })).toEqual(['Invoice paid']);
    expect(await messages(svc, { context: '^illing' })).toEqual([]);

    // Literal and case-insensitive: parentheses, % and _ are not special.
    expect(await messages(svc, { message: '(bad' })).toEqual(['login failed (bad password)']);
    expect(await messages(svc, { message: '100% sure_' })).toEqual(['100% sure_thing']);
    expect(await messages(svc, { message: '_' })).toEqual(['100% sure_thing']);
    expect(await messages(svc, { message: 'INVOICE' })).toEqual(['invoice issued', 'Invoice paid']);

    expect(await messages(svc, { from: '2026-09-21T09:01:00Z', to: '2026-09-21T09:03:00Z' })).toHaveLength(3);
    expect(await messages(svc, { from: 'garbage' })).toHaveLength(5);
    expect(await messages(svc, { requestId: 'req-2' })).toEqual(['100% sure_thing']);
    expect(await messages(svc, { traceId: 'tr-1' })).toEqual(['login failed (bad password)']);
    expect(await messages(svc, { hostname: 'nobody' })).toEqual([]);
  });

  it('pages through the database newest-first and oldest-first', async () => {
    const svc = service();
    await seed([
      { timestamp: at('2026-09-23T09:00:00Z'), level: 'INFO', message: 'db-0' },
      { timestamp: at('2026-09-23T09:01:00Z'), level: 'INFO', message: 'db-1' },
      { timestamp: at('2026-09-23T09:02:00Z'), level: 'INFO', message: 'db-2' },
      { timestamp: at('2026-09-23T10:00:00Z'), level: 'INFO', message: 'db-3' },
      { timestamp: at('2026-09-23T10:01:00Z'), level: 'INFO', message: 'db-4' },
    ]);

    const page = async (n: number, sort: 'asc' | 'desc') => (await svc.findLogs({ nodeEnv: ENV, page: n, limit: 2, sort })).data.map((e) => e.message);
    expect(await page(1, 'desc')).toEqual(['db-4', 'db-3']);
    expect(await page(2, 'desc')).toEqual(['db-2', 'db-1']);
    expect(await page(3, 'desc')).toEqual(['db-0']);
    expect(await page(1, 'asc')).toEqual(['db-0', 'db-1']);
    expect(await page(3, 'asc')).toEqual(['db-4']);

    const first = await svc.findLogs({ nodeEnv: ENV, page: 2, limit: 2, sort: 'desc' });
    expect(first.pagination).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3, hasNext: true, hasPrev: true });
    expect(first.data.map((e) => e._fromBuffer)).toEqual([false, false]);
  });

  it('reports distinct values and level counts', async () => {
    const svc = service();
    await seedStandard();

    expect(await svc.getDistinctValues('context', { nodeEnv: ENV })).toEqual(['AuthService', 'billing.invoice', 'BillingService']);
    expect(await svc.getDistinctValues('level', { nodeEnv: ENV })).toEqual(['DEBUG', 'ERROR', 'INFO', 'WARN']);
    expect(await svc.getDistinctValues('nodeEnv', { nodeEnv: ENV })).toEqual([ENV]);
    expect(await svc.getCountsByLevel({ nodeEnv: ENV })).toEqual({ ERROR: 1, WARN: 1, INFO: 2, DEBUG: 1 });
  });

  it('finds one persisted entry by id, omitting the fields it does not have', async () => {
    const svc = service();
    await seedStandard();
    const [any] = (await svc.findLogs({ ...query, message: 'no context' })).data;

    const found = await svc.findLogById(any._id!);
    expect(found).toMatchObject({ _id: any._id, message: 'no context here', level: 'DEBUG', _fromBuffer: false });
    expect(found).not.toHaveProperty('context');
    expect(found).not.toHaveProperty('data');
    expect(await svc.findLogById(any._id!.toUpperCase())).not.toBeNull();
    expect(await svc.findLogById('507f1f77bcf86cd799439011')).toBeNull();
    expect(await svc.findLogById('not-an-id')).toBeNull();
  });
});
