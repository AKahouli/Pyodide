import { inArray, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { PgGroupLookupAdapter } from './pg-group-lookup.adapter';
import { PgUserStore } from '@modules/user/persistence/pg-user.store';
import type { NewUser } from '@modules/user/persistence/user.store';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

describeIntegration('PgGroupLookupAdapter (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const adapter = new PgGroupLookupAdapter(db as NodePgDatabase<typeof schema>);
  const users = new PgUserStore(db as never);
  const createdGroups: string[] = [];
  const createdUsers: string[] = [];
  const createdOwners: string[] = [];
  let ownerId: string;

  const newUser = (): NewUser => ({
    email: `grp-lookup-${oid().slice(-8)}@example.com`,
    passwordHash: 'hash',
    emailVerified: true,
    status: 'active',
  });

  const makeGroup = async (name: string, memberIds: string[]): Promise<string> => {
    const id = oid();
    await db.insert(schema.identityUserGroups).values({ id, name, createdBy: ownerId });
    createdGroups.push(id);
    if (memberIds.length) {
      await db.insert(schema.identityUserGroupMembers).values(memberIds.map((userId, position) => ({ groupId: id, userId, position })));
    }
    return id;
  };

  beforeAll(async () => {
    const owner = await users.create(newUser());
    createdOwners.push(owner.id);
    ownerId = owner.id;
  });

  afterEach(async () => {
    // Groups first: their FK cascades clear user_group_members.
    const groups = createdGroups.splice(0);
    if (groups.length) await db.delete(schema.identityUserGroups).where(inArray(schema.identityUserGroups.id, groups));
    const ids = createdUsers.splice(0);
    if (ids.length) await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, ids));
  });
  afterAll(async () => {
    const owners = createdOwners.splice(0);
    if (owners.length) await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, owners));
    await close();
  });

  it('counts members per group', async () => {
    const m1 = await users.create(newUser());
    const m2 = await users.create(newUser());
    const m3 = await users.create(newUser());
    createdUsers.push(m1.id, m2.id, m3.id);
    const group = await makeGroup(`Lookup ${oid().slice(-6)}`, [m1.id, m2.id, m3.id]);

    const map = await adapter.summariesByIds([group]);
    expect(map.get(group)).toEqual({ id: group, name: expect.any(String), memberCount: 3 });
  });

  it('returns 0 for a group without members and skips unknown/invalid ids', async () => {
    const empty = await makeGroup(`Empty ${oid().slice(-6)}`, []);
    const map = await adapter.summariesByIds([empty, oid(), 'not-an-id', '']);
    expect(map.size).toBe(1);
    expect(map.get(empty)!.memberCount).toBe(0);
  });

  it('empty input returns an empty map without querying', async () => {
    expect(await adapter.summariesByIds([])).toEqual(new Map());
  });

  it('deduplicates repeated ids', async () => {
    const group = await makeGroup(`Dup ${oid().slice(-6)}`, []);
    const map = await adapter.summariesByIds([group, group.toUpperCase()]);
    expect(map.size).toBe(1);
    expect(await db.select().from(schema.identityUserGroups).where(eq(schema.identityUserGroups.id, group))).toHaveLength(1);
  });
});
