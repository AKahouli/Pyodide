import { inArray } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '@modules/postgres/testing/pg-integration';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { PgWorkspaceReadAdapter } from './pg-workspace-read.adapter';
import { PgWorkspaceDocumentReadAdapter } from './pg-workspace-document-read.adapter';
import { PgWorkspaceDocumentWriteAdapter } from './pg-workspace-document-write.adapter';
import { PgWorkspaceShareReadAdapter } from './pg-workspace-share-read.adapter';
import { PgWorkspaceSettingReadAdapter } from './pg-workspace-setting-read.adapter';
import type { WorkspaceDocumentRecord } from '../../ports/workspace-records';

describeIntegration('workspace PG port adapters', () => {
  const { db, close } = makeTestDb();
  const workspaceRead = new PgWorkspaceReadAdapter(db as never);
  const documentRead = new PgWorkspaceDocumentReadAdapter(db as never);
  const documentWrite = new PgWorkspaceDocumentWriteAdapter(db as never);
  const shareRead = new PgWorkspaceShareReadAdapter(db as never);
  const settingRead = new PgWorkspaceSettingReadAdapter(db as never);

  const OWNER = 'a1a1a1a1a1a1a1a1a1a1a1a1';
  const USER2 = 'b2b2b2b2b2b2b2b2b2b2b2b2';
  const createdWorkspaceIds: string[] = [];

  const createWorkspace = async (overrides: Record<string, unknown> = {}): Promise<string> => {
    const id = newObjectId();
    await db.insert(schema.workspaces).values({
      id,
      name: `WS ${id.slice(0, 8)}`,
      alias: `ws-${id.slice(0, 12)}`,
      storagePrefix: `sp-${id.slice(0, 12)}`,
      createdBy: OWNER,
      allocatedStorage: 1024,
      ...overrides,
    });
    createdWorkspaceIds.push(id);
    return id;
  };

  const insertDocument = async (workspaceId: string, overrides: Record<string, unknown> = {}): Promise<WorkspaceDocumentRecord> => {
    const id = newObjectId();
    await db.insert(schema.workspaceDocuments).values({
      id,
      originalName: `doc-${id.slice(0, 8)}.pdf`,
      mimeType: 'application/pdf',
      size: 10,
      workspaceId,
      createdBy: OWNER,
      status: 'completed',
      indexingStatus: 'ready',
      ...overrides,
    });
    return (await documentRead.findById(id))!;
  };

  afterEach(async () => {
    if (createdWorkspaceIds.length) {
      await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [...createdWorkspaceIds]));
      createdWorkspaceIds.length = 0;
    }
  });
  afterAll(close);

  it('reads workspaces and settings', async () => {
    const settingsId = newObjectId();
    await db.insert(schema.workspaceSettings).values({
      id: settingsId, name: 'Settings 1', createdBy: OWNER, chunks: 12, instruction: 'be nice', tag: 't1',
    });
    const wsId = await createWorkspace({ settingsId });

    const ws = await workspaceRead.findById(wsId);
    expect(ws).toMatchObject({ id: wsId, name: `WS ${wsId.slice(0, 8)}`, createdBy: OWNER, settingsId, allocatedStorage: 1024 });
    expect(await workspaceRead.exists(wsId)).toBe(true);
    expect(await workspaceRead.exists(newObjectId())).toBe(false);

    const settings = await settingRead.findById(settingsId);
    expect(settings).toMatchObject({ id: settingsId, chunks: 12, instruction: 'be nice', tag: 't1' });
    const many = await settingRead.findByIds([settingsId]);
    expect(many.get(settingsId)?.chunks).toBe(12);
  });

  it('translates document filters: status, indexingStartedBefore, search, keyset', async () => {
    const wsId = await createWorkspace();
    const old = await insertDocument(wsId, { indexingStatus: 'processing', indexingStartedAt: new Date(Date.now() - 3_600_000), createdAt: new Date(Date.now() - 10_000) });
    await insertDocument(wsId, { originalName: 'contract final.pdf', createdAt: new Date() });

    const byStatus = await documentRead.find({ workspaceId: wsId, indexingStatus: 'processing' });
    expect(byStatus.map((d) => d.id)).toEqual([old.id]);

    const stale = await documentRead.find(
      { status: 'completed', indexingStatus: 'processing', indexingStartedBefore: new Date(Date.now() - 60_000) },
      { limit: 10 },
    );
    expect(stale.map((d) => d.id)).toContain(old.id);

    const searched = await documentRead.find({ workspaceId: wsId, isFolder: false, originalNameSearch: 'contract FINAL' });
    expect(searched).toHaveLength(1);

    const page1 = await documentRead.find(
      { workspaceId: wsId, isFolder: false },
      { sort: { field: 'id', direction: 'asc' }, limit: 1 },
    );
    expect(page1).toHaveLength(1);
    const page2 = await documentRead.find(
      { workspaceId: wsId, isFolder: false, afterId: page1[0].id },
      { sort: { field: 'id', direction: 'asc' }, limit: 10 },
    );
    expect(page2.every((d) => d.id > page1[0].id)).toBe(true);
    expect(await documentRead.countDocuments({ workspaceId: wsId, isFolder: false })).toBe(2);
    expect(await documentRead.exists({ id: old.id, workspaceId: wsId, isFolder: false })).toBe(true);
  });

  it('writes indexing state: defined values set, present-undefined clears, absent untouched', async () => {
    const wsId = await createWorkspace();
    const doc = await insertDocument(wsId, { indexingError: 'old', indexingTaskId: 'task-1', metadata: { a: '1' }, chunkSize: 500 });

    await documentWrite.updateIndexingState(doc.id, {
      indexingStatus: 'failed',
      indexingError: undefined, // present-undefined clears
      chunk_size: 800,
      // metadata + indexingTaskId absent -> untouched
    });

    const after = await documentRead.findById(doc.id);
    expect(after!.indexingStatus).toBe('failed');
    expect(after!.indexingError).toBeUndefined();
    expect(after!.chunk_size).toBe(800);
    expect(after!.indexingTaskId).toBe('task-1');
    expect(after!.metadata).toEqual({ a: '1' });
    expect(after!.updatedAt.getTime()).toBeGreaterThan(after!.createdAt.getTime());
  });

  it('resolves share permissions per user', async () => {
    const wsId = await createWorkspace();
    await db.insert(schema.workspaceShares).values({
      id: newObjectId(), workspaceId: wsId, ownerId: OWNER, sharedWithUserId: USER2, permission: 'readwrite', sharedBy: OWNER,
    });

    expect(await shareRead.permissionFor(wsId, USER2)).toBe('readwrite');
    expect(await shareRead.permissionFor(wsId, OWNER)).toBeNull();
    expect((await shareRead.findForWorkspace(wsId)).map((s) => s.sharedWithUserId)).toEqual([USER2]);
    expect((await shareRead.findForUser(USER2)).map((s) => s.workspaceId)).toEqual([wsId]);
  });

  it('cascades document deletion with the workspace', async () => {
    const wsId = await createWorkspace();
    const doc = await insertDocument(wsId);
    await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [wsId]));
    createdWorkspaceIds.length = 0; // already deleted
    expect(await documentRead.findById(doc.id)).toBeNull();
  });
});
