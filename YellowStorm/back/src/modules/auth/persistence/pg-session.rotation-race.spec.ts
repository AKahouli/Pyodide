import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { PgUserStore } from '@modules/user/persistence/pg-user.store';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgSessionStore } from './pg-session.store';
import { RotationConflictError, type NewSession } from './session.store';

describeIntegration('PgSessionStore.rotateAtomic concurrency (integration)', () => {
  const { db, close } = makeTestDb();
  const typedDb = db as NodePgDatabase<typeof schema>;
  const store = new PgSessionStore(typedDb);
  const users = new PgUserStore(typedDb);
  const sessionIds: string[] = [];
  const userIds: string[] = [];
  let userId: string;

  const successor = (id: string, from: string): NewSession => ({
    id,
    userId,
    refreshTokenHash: `spec-hash-${id}`,
    deviceInfo: {},
    ipAddress: '127.0.0.1',
    expiresAt: new Date(Date.now() + 3_600_000),
    tokenFamily: 'spec-family',
    rotatedFromSessionId: from,
  });

  const rotate = (predecessorId: string, newId: string) => {
    sessionIds.push(newId);
    return store.rotateAtomic({
      predecessorId,
      newSession: successor(newId, predecessorId),
      bookkeeping: { rotatedAt: new Date(), rotatedToSessionId: newId },
    });
  };

  beforeAll(async () => {
    const user = await users.create({ email: `spec-rot-${newObjectId().slice(-8)}@example.com`, passwordHash: 'h', emailVerified: true, status: 'active' });
    userIds.push(user.id);
    userId = user.id;
  });

  afterAll(async () => {
    if (sessionIds.length) await db.delete(schema.identitySessions).where(inArray(schema.identitySessions.id, sessionIds));
    if (userIds.length) await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, userIds));
    await close();
  });

  const seedPredecessor = async (): Promise<string> => {
    const created = await store.create({
      userId,
      refreshTokenHash: 'spec-pred-hash',
      deviceInfo: {},
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 3_600_000),
      tokenFamily: 'spec-family',
    });
    sessionIds.push(created.id);
    return created.id;
  };

  it('two PARALLEL rotations of one session: exactly one wins, the loser gets RotationConflictError', async () => {
    const predecessorId = await seedPredecessor();
    const settled = await Promise.allSettled([rotate(predecessorId, newObjectId()), rotate(predecessorId, newObjectId())]);

    const ok = settled.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof rotate>>> => r.status === 'fulfilled');
    const failed = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(RotationConflictError);

    const winner = ok[0].value;
    const pred = await store.findById(predecessorId);
    expect(pred?.isValid).toBe(false);
    expect(pred?.rotatedToSessionId).toBe(winner.id);
    // Loser's successor must not exist (transaction rolled back).
    const loserId = sessionIds.slice(-2).find((id) => id !== winner.id)!;
    expect(await store.findById(loserId)).toBeNull();
    expect((await store.findById(winner.id))?.isValid).toBe(true);
  });

  it('many parallel rotations still yield a single winner', async () => {
    const predecessorId = await seedPredecessor();
    const settled = await Promise.allSettled([1, 2, 3, 4, 5].map(() => rotate(predecessorId, newObjectId())));
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of settled) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(RotationConflictError);
    }
  });

  it('a sequential re-rotation of an already-consumed session conflicts', async () => {
    const predecessorId = await seedPredecessor();
    await rotate(predecessorId, newObjectId());
    await expect(rotate(predecessorId, newObjectId())).rejects.toBeInstanceOf(RotationConflictError);
  });
});
