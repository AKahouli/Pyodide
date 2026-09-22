import { inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import * as schema from '@modules/postgres/schema';
import { PgNotificationStore } from './pg-notification.store';
import type { NewNotification } from './notification.store';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';

describeIntegration('PgNotificationStore (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const store = new PgNotificationStore(db as never);
  const created: string[] = [];

  const seed = async (over: Partial<NewNotification> & { status?: string } = {}) => {
    const { status, ...init }: NewNotification & { status?: string } = {
      userId: oid(),
      type: 'info',
      title: 'Smoke title',
      message: 'Smoke message',
      destination: 'user',
      sourceModule: 'smoke',
      expiresAt: new Date(Date.now() + 3_600_000),
      ...over,
    };
    const record = await store.create(init);
    created.push(record.id);
    if (status && status !== 'pending') {
      await db.update(schema.opsNotifications).set({ status }).where(inArray(schema.opsNotifications.id, [record.id]));
    }
    return record;
  };

  afterEach(async () => {
    const ids = created.splice(0);
    if (ids.length > 0) await db.delete(schema.opsNotifications).where(inArray(schema.opsNotifications.id, ids));
  });
  afterAll(async () => { await close(); });

  it('creates with flat metadata columns and reads back with defaults', async () => {
    const record = await seed({ priority: 'high', extra: { a: 1 } });
    const fetched = await store.findById(record.id);
    expect(fetched).toMatchObject({
      type: 'info',
      status: 'pending',
      sourceModule: 'smoke',
      priority: 'high',
      retryCount: 0,
      extra: { a: 1 },
    });
  });

  it('findForUser applies owner-or-broadcast, filters, pagination and total', async () => {
    const uid = oid();
    await seed({ userId: uid });
    await seed({ userId: uid, status: 'read' });
    await seed({ userId: uid, type: 'error' });
    await seed({ userId: uid, destination: 'broadcast' });

    const all = await store.findForUser(uid, { skip: 0, limit: 10 });
    expect(all.total).toBe(4); // 3 own + 1 broadcast

    const unreadOnly = await store.findForUser(uid, { unreadOnly: true, skip: 0, limit: 10 });
    expect(unreadOnly.total).toBe(3); // read one excluded

    const paged = await store.findForUser(uid, { skip: 1, limit: 2 });
    expect(paged.records).toHaveLength(2);
  });

  it('markReadByIdsForUser only touches owned or broadcast rows', async () => {
    const uid = oid();
    const own = await seed({ userId: uid });
    const foreign = await seed({ userId: oid() });
    const broadcast = await seed({ destination: 'broadcast' });

    const updated = await store.markReadByIdsForUser(uid, [own.id, foreign.id, broadcast.id]);

    expect(updated).toBe(2); // foreign untouched
    expect((await store.findById(own.id))!.status).toBe('read');
    expect((await store.findById(broadcast.id))!.status).toBe('read');
    expect((await store.findById(foreign.id))!.status).toBe('pending');
  });

  it('markSent and markFailed maintain sent/read and retry bookkeeping', async () => {
    const a = await seed();
    await store.markSent(a.id);
    expect(await store.findById(a.id)).toMatchObject({ status: 'sent', sentAt: expect.any(Date) });

    await store.markFailed(a.id, 'smtp down');
    await store.markFailed(a.id, 'smtp down again');
    const after = await store.findById(a.id)!;
    expect(after).toMatchObject({ status: 'failed', lastError: 'smtp down again', retryCount: 2 });
  });
});
