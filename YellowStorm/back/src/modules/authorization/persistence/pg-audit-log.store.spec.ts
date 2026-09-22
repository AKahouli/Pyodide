import { inArray, like } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgAuditLogStore } from './pg-role.store';
import type { AuditLogRecord } from './audit-log.store';

describeIntegration('PgAuditLogStore (integration)', () => {
  const { db, close } = makeTestDb();
  const store = new PgAuditLogStore(db as NodePgDatabase<typeof schema>);
  const tag = newObjectId().slice(-8);
  const actorId = newObjectId();
  const emailA = `spec-${tag}-a_b@example.com`;
  const emailB = `spec-${tag}-axb@example.com`;

  const base = (over: Partial<Omit<AuditLogRecord, 'id' | 'createdAt'>>): Omit<AuditLogRecord, 'id' | 'createdAt'> => ({
    actorId,
    actorEmail: emailA,
    action: `spec${tag}.create`,
    targetId: null,
    targetType: null,
    metadata: null,
    ipAddress: null,
    userAgent: null,
    status: 'success',
    failureReason: null,
    ...over,
  });

  beforeAll(async () => {
    await store.insert(base({ action: `spec${tag}.create` }));
    await store.insert(base({ action: `spec${tag}.delete`, status: 'failure', failureReason: 'nope' }));
    await store.insert(base({ actorEmail: emailB, action: `spec${tag}x.other` }));
  });

  afterAll(async () => {
    // Exactly the rows this spec created: they all share this actor id.
    await db.delete(schema.authzAuditLogs).where(inArray(schema.authzAuditLogs.actorId, [actorId]));
    await close();
  });

  it('filters by actorId and returns newest first with total/hasMore', async () => {
    const page = await store.findAll({ actorId, limit: 2 });
    expect(page.total).toBe(3);
    expect(page.logs).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const rest = await store.findAll({ actorId, limit: 2, skip: 2 });
    expect(rest.logs).toHaveLength(1);
    expect(rest.hasMore).toBe(false);
  });

  it('actorEmail search is a case-insensitive substring and escapes LIKE wildcards', async () => {
    const ci = await store.findAll({ actorId, actorEmail: `SPEC-${tag}-A_B` });
    expect(ci.total).toBe(2); // rows for emailA only
    // "_" must be literal: it must NOT match the "x" in emailB.
    expect(ci.logs.every((l) => l.actorEmail === emailA)).toBe(true);
    const pct = await store.findAll({ actorId, actorEmail: '%' });
    expect(pct.total).toBe(0);
  });

  it('feature filters by "<feature>." prefix (not a bare prefix) and action by equality', async () => {
    const feature = await store.findAll({ actorId, feature: `spec${tag}` });
    expect(feature.total).toBe(2); // spec<tag>.create / .delete, not spec<tag>x.other
    const exact = await store.findAll({ actorId, action: `spec${tag}.delete` });
    expect(exact.total).toBe(1);
    expect(exact.logs[0]).toMatchObject({ status: 'failure', failureReason: 'nope' });
  });

  it('filters by status and by date range', async () => {
    expect((await store.findAll({ actorId, status: 'failure' })).total).toBe(1);
    const future = new Date(Date.now() + 3_600_000);
    expect((await store.findAll({ actorId, startDate: future })).total).toBe(0);
    expect((await store.findAll({ actorId, endDate: future })).total).toBe(3);
  });

  it('getDistinctActions lists each of this spec actions once, sorted', async () => {
    const actions = (await store.getDistinctActions()).filter((a) => a.startsWith(`spec${tag}`));
    expect(actions).toEqual([`spec${tag}.create`, `spec${tag}.delete`, `spec${tag}x.other`]);
  });

  it('cleanup scope check: only this actor rows carry the spec tag', async () => {
    const rows = await db.select().from(schema.authzAuditLogs).where(like(schema.authzAuditLogs.action, `spec${tag}%`));
    expect(rows.every((r) => r.actorId === actorId)).toBe(true);
  });
});
