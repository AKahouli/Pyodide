import { inArray } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '@modules/postgres/testing/pg-integration';
import { newObjectId } from '@common/postgres/object-id';
import * as schema from '@modules/postgres/schema';
import { PostgresProjectStore } from './postgres-project-store';
import { PostgresProjectShareStore } from './postgres-project-share-store';

describeIntegration('project PG stores', () => {
  const { db, pool, close } = makeTestDb();
  const projectStore = new PostgresProjectStore(db as never);
  const shareStore = new PostgresProjectShareStore(db as never);

  const OWNER = 'a1a1a1a1a1a1a1a1a1a1a1a1';
  const OTHER = 'b2b2b2b2b2b2b2b2b2b2b2b2';
  const createdProjectIds: string[] = [];

  const createProject = async (name: string, createdBy = OWNER): Promise<string> => {
    const record = await projectStore.create({ name, createdBy });
    createdProjectIds.push(record.id);
    return record.id;
  };

  afterEach(async () => {
    if (createdProjectIds.length) {
      await db.delete(schema.projects).where(inArray(schema.projects.id, [...createdProjectIds]));
      createdProjectIds.length = 0;
    }
  });
  afterAll(close);

  it('creates, reads and updates a project', async () => {
    const id = await createProject('Alpha');
    const found = await projectStore.findById(id);
    expect(found).toMatchObject({ id, name: 'Alpha', createdBy: OWNER, isPublic: false, shareCount: 0 });

    const updated = await projectStore.updateById(id, { name: 'Alpha2', isPublic: true });
    expect(updated).toMatchObject({ id, name: 'Alpha2', isPublic: true });
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(updated!.createdAt.getTime() - 1);
  });

  it('finds by owner with case-insensitive search and duplicate checks', async () => {
    await createProject('Contrat BPCE');
    await createProject('Autre');
    await createProject('Contrat autre', OTHER);

    const mine = await projectStore.findByOwner(OWNER, 'contrat');
    expect(mine.map((p) => p.name)).toEqual(['Contrat BPCE']);

    expect(await projectStore.findOne({ name: 'Contrat BPCE', createdBy: OWNER })).not.toBeNull();
    expect(
      await projectStore.findOne({ name: 'Contrat BPCE', createdBy: OWNER, excludeId: (await projectStore.findByOwner(OWNER, 'Contrat BPCE'))[0].id }),
    ).toBeNull();
    expect(await projectStore.existsOwnedBy(mine[0].id, OWNER)).toBe(true);
    expect(await projectStore.existsOwnedBy(mine[0].id, OTHER)).toBe(false);
  });

  it('rejects a duplicate (createdBy, name)', async () => {
    await createProject('Unique');
    await expect(projectStore.create({ name: 'Unique', createdBy: OWNER })).rejects.toThrow();
  });

  it('increments the stored shareCount counter', async () => {
    const id = await createProject('Counter');
    await projectStore.incrementShareCount(id, 2);
    await projectStore.incrementShareCount(id, -1);
    expect((await projectStore.findById(id))!.shareCount).toBe(1);
  });

  it('creates shares with total counts, permission updates and cascade delete', async () => {
    const projectId = await createProject('Shared');
    const user1 = newObjectId();
    const user2 = newObjectId();

    await shareStore.create({ projectId, ownerId: OWNER, sharedWithUserId: user1, permission: 'read', sharedBy: OWNER });
    await shareStore.create({ projectId, ownerId: OWNER, sharedWithUserId: user2, permission: 'readwrite', sharedBy: OWNER });

    const page = await shareStore.findByProject(projectId, { limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);

    expect(await shareStore.existsForUser(projectId, user1)).toBe(true);
    await expect(
      shareStore.create({ projectId, ownerId: OWNER, sharedWithUserId: user1, permission: 'read', sharedBy: OWNER }),
    ).rejects.toThrow();

    const updated = await shareStore.updatePermission(page.rows[0].id, 'readwrite');
    expect(updated!.permission).toBe('readwrite');

    const removed = await shareStore.deleteByProject(projectId);
    expect(removed).toBe(2);
  });

  it('cascades share deletion when the project is deleted', async () => {
    const projectId = await createProject('Doomed');
    const user = newObjectId();
    await shareStore.create({ projectId, ownerId: OWNER, sharedWithUserId: user, permission: 'read', sharedBy: OWNER });

    await projectStore.deleteById(projectId);

    expect(await projectStore.findById(projectId)).toBeNull();
    expect(await shareStore.existsForUser(projectId, user)).toBe(false);
  });
});
