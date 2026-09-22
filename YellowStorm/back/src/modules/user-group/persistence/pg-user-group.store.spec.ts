import { inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgUserGroupStore } from './pg-user-group.store';
import { PgUserStore } from '@modules/user/persistence/pg-user.store';
import type { NewUser } from '@modules/user/persistence/user.store';
import { ConflictException } from '@modules/exceptions';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

describeIntegration('PgUserGroupStore members (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const store = new PgUserGroupStore(db as NodePgDatabase<typeof schema>);
  const users = new PgUserStore(db as NodePgDatabase<typeof schema>);
  const createdGroups: string[] = [];
  const createdUsers: string[] = [];
  let ownerId: string;

  const newUser = (): NewUser => ({
    email: `grp-${oid().slice(-8)}@example.com`,
    passwordHash: 'hash',
    emailVerified: true,
    status: 'active',
  });

  const memberIds = async (groupId: string): Promise<string[]> =>
    (await store.findOwnedById(ownerId, groupId))!.members.map((m) => m.id);

  afterEach(async () => {
    const groups = createdGroups.splice(0);
    if (groups.length) await db.delete(schema.identityUserGroups).where(inArray(schema.identityUserGroups.id, groups));
    const ids = createdUsers.splice(0);
    if (ids.length) await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, ids));
  });
  afterAll(async () => { await close(); });

  // R-11: batch adds must append DISTINCT positions and members must come
  // back in insertion order.
  it('keeps member order across create and batch addMembers', async () => {
    const [a, b, c, d, e] = await Promise.all([users.create(newUser()), users.create(newUser()), users.create(newUser()), users.create(newUser()), users.create(newUser())]);
    createdUsers.push(a.id, b.id, c.id, d.id, e.id);
    ownerId = a.id;

    const group = await store.create({ ownerId, name: `Order ${oid().slice(-6)}`, description: '', memberIds: [a.id, b.id, c.id] });
    createdGroups.push(group.id);
    expect(await memberIds(group.id)).toEqual([a.id, b.id, c.id]);

    await store.addMembers(group.id, [d.id, e.id]);
    expect(await memberIds(group.id)).toEqual([a.id, b.id, c.id, d.id, e.id]);

    // Re-adding an existing member is a no-op (no duplicate, no reorder).
    await store.addMembers(group.id, [a.id]);
    expect(await memberIds(group.id)).toEqual([a.id, b.id, c.id, d.id, e.id]);
  });

  it('surfaces a duplicate (owner, name) race as ConflictException', async () => {
    const owner = await users.create(newUser());
    createdUsers.push(owner.id);
    ownerId = owner.id;
    const name = `Dup ${oid().slice(-6)}`;

    const results = await Promise.allSettled([
      store.create({ ownerId, name, description: '', memberIds: [] }),
      store.create({ ownerId, name, description: '', memberIds: [] }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    createdGroups.push((fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value.id);
  });
});
