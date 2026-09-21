import { inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgSessionStore } from './pg-session.store';
import { PgUserStore } from '@modules/user/persistence/pg-user.store';
import type { NewUser } from '@modules/user/persistence/user.store';
import type { NewSession } from './session.store';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

describeIntegration('PgSessionStore max-sessions cap (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const store = new PgSessionStore(db as NodePgDatabase<typeof schema>);
  const users = new PgUserStore(db as NodePgDatabase<typeof schema>);
  const createdSessions: string[] = [];
  const createdUsers: string[] = [];
  let userId: string;

  const insertSession = async (overrides: Partial<NewSession> & { lastActivityAt?: Date }): Promise<string> => {
    const id = oid();
    await db.insert(schema.identitySessions).values({
      id,
      userId,
      refreshTokenHash: 'hash',
      deviceInfo: {},
      ipAddress: '127.0.0.1',
      isValid: true,
      expiresAt: new Date(Date.now() + 3_600_000),
      tokenFamily: 'family',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as typeof schema.identitySessions.$inferInsert);
    createdSessions.push(id);
    return id;
  };

  beforeEach(async () => {
    const user = await users.create({
      email: `sess-cap-${oid().slice(-8)}@example.com`,
      passwordHash: 'hash',
      emailVerified: true,
      status: 'active',
    } satisfies NewUser);
    createdUsers.push(user.id);
    userId = user.id;
  });

  afterEach(async () => {
    const ids = createdSessions.splice(0);
    if (ids.length) await db.delete(schema.identitySessions).where(inArray(schema.identitySessions.id, ids));
    const usersToDelete = createdUsers.splice(0);
    if (usersToDelete.length) await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, usersToDelete));
  });
  afterAll(async () => { await close(); });

  it('keeps the newest N by last_activity_at and invalidates the rest in one shot', async () => {
    const base = Date.now() - 60_000;
    const oldest = await insertSession({ lastActivityAt: new Date(base) });
    const mid = await insertSession({ lastActivityAt: new Date(base + 10_000) });
    const newest = await insertSession({ lastActivityAt: new Date(base + 20_000) });

    const invalidated = await store.invalidateOldestBeyond(userId, 2);
    expect(invalidated).toBe(1);

    const sessions = await db.select().from(schema.identitySessions).where(inArray(schema.identitySessions.id, [oldest, mid, newest]));
    const byId = new Map(sessions.map((s) => [s.id, s]));
    expect(byId.get(oldest)!.isValid).toBe(false);
    expect(byId.get(mid)!.isValid).toBe(true);
    expect(byId.get(newest)!.isValid).toBe(true);
  });

  it('is a no-op when the user is within the cap', async () => {
    const only = await insertSession({ lastActivityAt: new Date() });
    expect(await store.invalidateOldestBeyond(userId, 3)).toBe(0);
    expect((await store.findById(only))!.isValid).toBe(true);
    expect(await store.invalidateOldestBeyond(oid(), 3)).toBe(0);
  });
});
