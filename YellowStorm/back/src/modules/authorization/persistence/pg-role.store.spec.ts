import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { PgUserStore } from '@modules/user/persistence/pg-user.store';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgRoleStore } from './pg-role.store';

describeIntegration('PgRoleStore (integration)', () => {
  const { db, close } = makeTestDb();
  const typedDb = db as NodePgDatabase<typeof schema>;
  const roles = new PgRoleStore(typedDb);
  const users = new PgUserStore(typedDb);
  const tag = newObjectId().slice(-8);
  const roleIds: string[] = [];
  const userIds: string[] = [];

  const mkRole = async (suffix: string, permissions: string[] = ['spec.read']) => {
    const role = await roles.create({ name: `spec-${tag}-${suffix}`, description: 'spec role', permissions });
    roleIds.push(role.id);
    return role;
  };
  const mkUser = async () => {
    const user = await users.create({
      email: `spec-role-${newObjectId().slice(-8)}@example.com`,
      passwordHash: 'hash',
      emailVerified: true,
      status: 'active',
    });
    userIds.push(user.id);
    return user;
  };

  afterAll(async () => {
    if (userIds.length) await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, userIds));
    if (roleIds.length) await db.delete(schema.authzRoles).where(inArray(schema.authzRoles.id, roleIds));
    await close();
  });

  it('creates lower-cased roles and finds them by id/name/ids', async () => {
    const role = await roles.create({ name: `SPEC-${tag}-Upper`, description: 'd', permissions: ['a', 'b'] });
    roleIds.push(role.id);
    expect(role.name).toBe(`spec-${tag}-upper`);
    expect((await roles.findByName(`SPEC-${tag}-UPPER`))?.id).toBe(role.id);
    expect((await roles.findById(role.id))?.permissions).toEqual(['a', 'b']);
    expect((await roles.findByIds([role.id, 'not-an-id'])).size).toBe(1);
    expect(await roles.findById('not-an-id')).toBeNull();
  });

  it('updates a role and returns null for an unknown id', async () => {
    const role = await mkRole('upd');
    const updated = await roles.update(role.id, { description: 'changed', isActive: false });
    expect(updated).toMatchObject({ description: 'changed', isActive: false });
    expect((await roles.findAllActive()).some((r) => r.id === role.id)).toBe(false);
    expect(await roles.update(newObjectId(), { description: 'x' })).toBeNull();
  });

  it('addRoleAndBump / removeRoleAndBump change membership and bump permissions_version atomically', async () => {
    const role = await mkRole('bump');
    const user = await mkUser();
    const before = (await users.findById(user.id))!.permissionsVersion;

    await users.addRoleAndBump(user.id, role.id);
    // Idempotent membership, but every call bumps the version.
    await users.addRoleAndBump(user.id, role.id);
    const rows = await db.select().from(schema.identityUserRoles).where(inArray(schema.identityUserRoles.userId, [user.id]));
    expect(rows.filter((r) => r.roleId === role.id)).toHaveLength(1);
    expect((await users.findById(user.id))!.permissionsVersion).toBe(before + 2);

    await users.removeRoleAndBump(user.id, role.id);
    const after = await db.select().from(schema.identityUserRoles).where(inArray(schema.identityUserRoles.userId, [user.id]));
    expect(after).toHaveLength(0);
    expect((await users.findById(user.id))!.permissionsVersion).toBe(before + 3);
  });

  it('deleteByIdAndDetach removes the role, detaches users and bumps only affected users', async () => {
    const role = await mkRole('del');
    const holder = await mkUser();
    const bystander = await mkUser();
    await users.addRole(holder.id, role.id);
    const holderBefore = (await users.findById(holder.id))!.permissionsVersion;
    const bystanderBefore = (await users.findById(bystander.id))!.permissionsVersion;

    const deleted = await roles.deleteByIdAndDetach(role.id);
    expect(deleted?.id).toBe(role.id);
    expect(await roles.findById(role.id)).toBeNull();
    const junction = await db.select().from(schema.identityUserRoles).where(inArray(schema.identityUserRoles.roleId, [role.id]));
    expect(junction).toHaveLength(0);
    expect((await users.findById(holder.id))!.permissionsVersion).toBe(holderBefore + 1);
    expect((await users.findById(bystander.id))!.permissionsVersion).toBe(bystanderBefore);

    expect(await roles.deleteByIdAndDetach(role.id)).toBeNull();
    expect(await roles.deleteByIdAndDetach('nope')).toBeNull();
  });

  it('ensureDefaults is idempotent and never overwrites an existing role', async () => {
    const name = `spec-${tag}-seed`;
    await roles.ensureDefaults([{ name, description: 'first', permissions: ['x'], priority: 3 }]);
    await roles.ensureDefaults([{ name, description: 'second', permissions: ['y'], priority: 9 }]);
    const found = await roles.findByName(name);
    expect(found).toMatchObject({ description: 'first', permissions: ['x'], priority: 3, isSystem: true });
    roleIds.push(found!.id);
    const all = (await roles.findAll()).filter((r) => r.name === name);
    expect(all).toHaveLength(1);
    await expect(roles.ensureDefaults([])).resolves.toBeUndefined();
  });

  it('two parallel ensureDefaults of the same name leave exactly one row', async () => {
    const name = `spec-${tag}-seedrace`;
    const seed = { name, description: 'd', permissions: [] as string[] };
    await Promise.all([roles.ensureDefaults([seed]), roles.ensureDefaults([seed]), roles.ensureDefaults([seed])]);
    const found = (await roles.findAll()).filter((r) => r.name === name);
    expect(found).toHaveLength(1);
    roleIds.push(found[0].id);
  });
});
