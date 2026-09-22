import { inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgUserLookupAdapter } from './pg-user-lookup.adapter';
import { PgUserStore } from '../persistence/pg-user.store';
import type { NewUser } from '../persistence/user.store';

describeIntegration('PgUserLookupAdapter (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const store = new PgUserStore(db as never);
  const adapter = new PgUserLookupAdapter(store);
  const created: string[] = [];

  const newUser = (over: Partial<NewUser> = {}): NewUser => ({
    email: `lookup-${oid().slice(-8)}@Example.com`,
    passwordHash: 'hash',
    emailVerified: true,
    status: 'active',
    ...over,
  });

  afterEach(async () => {
    const ids = created.splice(0);
    if (ids.length > 0) await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, ids));
  });
  afterAll(async () => { await close(); });

  it('byId returns the populated summary or null', async () => {
    const a = await store.create(newUser({ firstName: 'Ann', lastName: 'Lee', status: 'suspended' }));
    created.push(a.id);

    const hit = await adapter.byId(a.id);
    expect(hit).toEqual({ id: a.id, email: a.email.toLowerCase(), firstName: 'Ann', lastName: 'Lee', status: 'suspended' });
    expect(await adapter.byId(oid())).toBeNull();
  });

  it('byIds ignores unknown ids and maps by id', async () => {
    const a = await store.create(newUser());
    const b = await store.create(newUser());
    created.push(a.id, b.id);

    const map = await adapter.byIds([a.id, b.id, oid()]);
    expect([...map.keys()].sort()).toEqual([a.id, b.id].sort());
    expect(await adapter.byIds([oid()])).toEqual(new Map());
    expect(await adapter.byIds([])).toEqual(new Map());
  });

  it('byEmails keys the map lowercased for mixed-case input', async () => {
    const a = await store.create(newUser());
    const b = await store.create(newUser());
    created.push(a.id, b.id);

    const map = await adapter.byEmails([a.email.toUpperCase(), b.email, `nope-${oid().slice(-6)}@example.com`]);
    expect(map.get(a.email.toLowerCase())!.id).toBe(a.id);
    expect(map.get(b.email.toLowerCase())!.id).toBe(b.id);
    expect(map.size).toBe(2);
    expect(await adapter.byEmails([])).toEqual(new Map());
  });
});
