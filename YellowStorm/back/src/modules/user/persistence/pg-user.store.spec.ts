import { inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import * as schema from '@modules/postgres/schema';
import { PgUserStore } from './pg-user.store';
import type { NewUser } from './user.store';
import { sql as sqlTag } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';

describeIntegration('PgUserStore (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const store = new PgUserStore(db as never);
  const created: string[] = [];
  const roleCleanup: string[] = [];

  const newUser = (over: Partial<NewUser> = {}): NewUser => ({
    email: `recorder-${oid().slice(-8)}@example.com`,
    passwordHash: 'hash',
    emailVerified: true,
    status: 'active',
    ...over,
  });

  /** Real authz.roles row — the junction FK rejects arbitrary ids. */
  const makeRole = async (): Promise<string> => {
    const id = oid();
    await db.insert(schema.authzRoles).values({ id, name: `role_${id.slice(-8)}`, description: 'spec fixture' });
    roleCleanup.push(id);
    return id;
  };

  afterEach(async () => {
    const ids = created.splice(0);
    if (ids.length > 0) await db.delete(schema.identityUserRoles).where(inArray(schema.identityUserRoles.userId, ids));
    if (ids.length > 0) await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, ids));
    const roles = roleCleanup.splice(0);
    if (roles.length > 0) await db.delete(schema.authzRoles).where(inArray(schema.authzRoles.id, roles));
  });
  afterAll(async () => { await close(); });

  it('create → findById round-trips flat columns and role order', async () => {
    const init = newUser({ firstName: 'Jane', lastName: 'Doe', profileRole: 'Engineer', registrationApproval: 'approved' });
    const record = await store.create(init);
    created.push(record.id);

    const fetched = await store.findById(record.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.email).toBe(init.email);
    expect(fetched!.firstName).toBe('Jane');
    expect(fetched!.profileRole).toBe('Engineer');
    expect(fetched!.roleIds).toEqual([]);
    expect(fetched!.colorTheme).toBe('default');
    expect(fetched!.status).toBe('active');
  });

  it('update patches explicit columns, clears nulls, and stamps updated_at', async () => {
    // fk_users_plan requires the referenced plan to exist.
    await db.execute(sqlTag`INSERT INTO catalog.plans (id, name, slug) VALUES ('64b000000000000000000009', 'Spec Plan', 'spec-plan') ON CONFLICT (id) DO NOTHING`);
    const record = await store.create(newUser());
    created.push(record.id);
    const before = record.updatedAt;
    await new Promise((r) => setTimeout(r, 5));

    const updated = await store.update(record.id, {
      firstName: 'Ray',
      emailVerified: false,
      planId: '64b000000000000000000009',
      emailVerificationToken: null,
    });
    expect(updated!.firstName).toBe('Ray');
    expect(updated!.emailVerified).toBe(false);
    expect(updated!.planId).toBe('64b000000000000000000009');
    expect(updated!.emailVerificationToken).toBeNull();
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(before.getTime());

    const cleared = await store.update(record.id, { planId: null });
    expect(cleared!.planId).toBeNull();
  });

  it('role junction keeps order; add/remove stay idempotent', async () => {
    const roleA = await makeRole();
    const roleB = await makeRole();
    const record = await store.create(newUser({ roleIds: [roleA, roleB] }));
    created.push(record.id);
    expect((await store.findById(record.id))!.roleIds).toEqual([roleA, roleB]);

    await store.removeRole(record.id, roleA);
    expect((await store.findById(record.id))!.roleIds).toEqual([roleB]);

    await store.addRole(record.id, roleA);
    await store.addRole(record.id, roleA);
    const roles = (await store.findById(record.id))!.roleIds;
    expect(roles).toEqual([roleB, roleA]);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('searchActive matches case-insensitively and treats % literally', async () => {
    const special = `${oid().slice(-6)}pct%sign@example.com`;
    const a = await store.create(newUser({ email: special }));
    const b = await store.create(newUser({ email: `plain${oid().slice(-6)}@example.com` }));
    created.push(a.id, b.id);

    const hits = await store.searchActive('PCT%SIGN', { limit: 10 });
    expect(hits.map((r) => r.id)).toContain(a.id);

    // % must not act as a wildcard: searching it cannot return the plain user.
    const wildcard = await store.searchActive('%', { limit: 100 });
    expect(wildcard.map((r) => r.id)).not.toContain(b.id);
  });

  it('bumpPermissionsVersion increments only the targeted users', async () => {
    const a = await store.create(newUser());
    const b = await store.create(newUser());
    created.push(a.id, b.id);
    await store.bumpPermissionsVersion([a.id]);
    expect((await store.findById(a.id))!.permissionsVersion).toBe(2);
    expect((await store.findById(b.id))!.permissionsVersion).toBe(1);
  });

  it('countByStatus and setColorThemeForAll see the fixtures', async () => {
    const a = await store.create(newUser({ status: 'suspended' }));
    created.push(a.id);
    const counts = await store.countByStatus();
    expect(counts.suspended).toBeGreaterThanOrEqual(1);

    await store.setColorThemeForAll('orange');
    expect((await store.findById(a.id))!.colorTheme).toBe('orange');
    await store.setColorThemeForAll('default');
  });

  // R-10: pagination must count USERS, not joined rows — a user with 3 roles
  // used to eat 3 slots of the page.
  it('listAdmin pages users (not role rows) and keeps complete role lists in order', async () => {
    const marker = `r10${oid().slice(-8)}`;
    const roleA = await makeRole();
    const roleB = await makeRole();
    const roleC = await makeRole();
    const multi = await store.create(newUser({ email: `${marker}-multi@example.com`, roleIds: [roleA, roleB, roleC] }));
    const plain1 = await store.create(newUser({ email: `${marker}-p1@example.com` }));
    const plain2 = await store.create(newUser({ email: `${marker}-p2@example.com` }));
    created.push(multi.id, plain1.id, plain2.id);

    const paging = { search: marker, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };
    const page = await store.listAdmin({ ...paging, limit: 2, page: 1 });
    expect(page.users).toHaveLength(2);
    expect(page.total).toBe(3);
    for (const user of page.users) {
      if (user.id === multi.id) expect(user.roles.map((r) => r.id)).toEqual([roleA, roleB, roleC]);
      else expect(user.roles).toEqual([]);
    }

    const page2 = await store.listAdmin({ ...paging, limit: 2, page: 2 });
    expect(page2.users).toHaveLength(1);
    const page1Ids = page.users.map((u) => u.id);
    expect(page2.users.every((u) => !page1Ids.includes(u.id))).toBe(true);
  });

  // R-15: two parallel creates with the same email → one wins, one 409, no 500.
  it('surfaces a duplicate-email race as ConflictException', async () => {
    const email = `race-${oid().slice(-8)}@example.com`;
    const results = await Promise.allSettled([
      store.create(newUser({ email })),
      store.create(newUser({ email })),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejectedRecord = (rejected[0] as PromiseRejectedResult).reason as { status?: number };
    expect(rejectedRecord.status).toBe(409);
    created.push((fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value.id);
  });
});
