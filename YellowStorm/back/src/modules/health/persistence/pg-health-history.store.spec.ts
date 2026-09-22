import { Types } from 'mongoose';
import { PgHealthHistoryStore } from './pg-health-history.store';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';

describeIntegration('PgHealthHistoryStore (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const store = new PgHealthHistoryStore(db as never);
  const created: string[] = [];

  afterAll(async () => {
    if (created.length) await db.execute(`DELETE FROM ops.health_history WHERE id IN (${created.map((id) => `'${id}'`).join(',')})`);
    await close();
  });

  const entry = (status: 'healthy' | 'unhealthy' | 'degraded') => ({
    status,
    timestamp: new Date().toISOString(),
    version: 'test',
    uptime: 12.5,
    checks: { database: { status: 'up' as const, responseTime: 3, lastChecked: new Date().toISOString() } },
  });

  it('inserts with recordedAt and expireAt, then filters by range and status', async () => {
    const expireAt = new Date(Date.now() + 3_600_000);
    const row = await store.insert(entry('healthy'), expireAt);
    created.push(row._id);

    expect(row.recordedAt).toBeInstanceOf(Date);
    expect(row.expireAt.getTime()).toBe(expireAt.getTime());

    const range = await store.findRange({
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
      status: 'healthy',
      limit: 10,
      skip: 0,
    });
    expect(range.records.map((r) => r._id)).toContain(row._id);
    expect(range.total).toBeGreaterThanOrEqual(1);

    const degraded = await store.findRange({
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
      status: 'degraded',
      limit: 10,
      skip: 0,
    });
    expect(degraded.records.map((r) => r._id)).not.toContain(row._id);

    const all = await store.findAllInRange(new Date(Date.now() - 60_000), new Date(Date.now() + 60_000));
    expect(all.map((r) => r._id)).toContain(row._id);
  });
});
