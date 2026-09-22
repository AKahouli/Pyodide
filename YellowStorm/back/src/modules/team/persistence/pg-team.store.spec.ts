import { inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgTeamStore } from './pg-team.store';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

describeIntegration('PgTeamStore list (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const store = new PgTeamStore(db as NodePgDatabase<typeof schema>);
  const createdTeams: string[] = [];
  let ownerId: string;

  const insertTeam = async (name: string): Promise<string> => {
    const id = oid();
    await db.insert(schema.teams).values({ id, name, createdBy: ownerId, createdAt: new Date(), updatedAt: new Date() });
    createdTeams.push(id);
    return id;
  };

  beforeAll(async () => {
    ownerId = oid();
    await db.insert(schema.identityUsers).values({
      id: ownerId,
      email: `team-list-${ownerId.slice(-8)}@example.com`,
      passwordHash: 'hash',
      emailVerified: true,
      status: 'active',
    });
  });

  afterEach(async () => {
    const ids = createdTeams.splice(0);
    if (ids.length) await db.delete(schema.teams).where(inArray(schema.teams.id, ids));
  });
  afterAll(async () => {
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId]));
    await close();
  });

  it('search treats % and _ literally (R-12)', async () => {
    const withPct = await insertTeam(`spec-100%team-${oid().slice(-4)}`);
    const plain = await insertTeam(`spec-plain-${oid().slice(-6)}`);

    const hits = await store.list({ createdBy: ownerId, search: '100%team', page: 1, limit: 50 });
    expect(hits.rows.map((r) => r.id)).toContain(withPct);

    const wildcard = await store.list({ createdBy: ownerId, search: '%', page: 1, limit: 50 });
    expect(wildcard.rows.map((r) => r.id)).not.toContain(plain);
  });

  it('reports the real total when the requested page is past the end (R-12)', async () => {
    const marker = `page${oid().slice(-6)}`;
    await insertTeam(`${marker}-a`);
    await insertTeam(`${marker}-b`);
    await insertTeam(`${marker}-c`);

    const page1 = await store.list({ createdBy: ownerId, search: marker, page: 1, limit: 2 });
    expect(page1.rows).toHaveLength(2);
    expect(page1.total).toBe(3);

    const page2 = await store.list({ createdBy: ownerId, search: marker, page: 2, limit: 2 });
    expect(page2.rows).toHaveLength(1);
    expect(page2.total).toBe(3);

    // Past the end: 0 rows, but the real total (was reported as 0).
    const page3 = await store.list({ createdBy: ownerId, search: marker, page: 3, limit: 2 });
    expect(page3.rows).toHaveLength(0);
    expect(page3.total).toBe(3);
  });
});
