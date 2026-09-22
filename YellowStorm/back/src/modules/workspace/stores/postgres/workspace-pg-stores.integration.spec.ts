import { eq, inArray } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '@modules/postgres/testing/pg-integration';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { PgWorkspaceStore } from './pg-workspace-store';
import { PgDocumentStore } from './pg-document-store';
import { PgShareStore } from './pg-share-store';
import { PgSettingStore } from './pg-setting-store';
import { PgUploadSessionStore } from './pg-upload-session-store';

describeIntegration('workspace PG stores (internal write paths)', () => {
  const { db, close } = makeTestDb();
  const workspaceStore = new PgWorkspaceStore(db as never);
  const documentStore = new PgDocumentStore(db as never);
  const shareStore = new PgShareStore(db as never);
  const settingStore = new PgSettingStore(db as never);
  const sessionStore = new PgUploadSessionStore(db as never);

  const OWNER = 'a1a1a1a1a1a1a1a1a1a1a1a1';
  const USER2 = 'b2b2b2b2b2b2b2b2b2b2b2b2';
  const cleanupWorkspaceIds: string[] = [];
  const cleanupSettingIds: string[] = [];

  const createWorkspace = async (overrides: Record<string, unknown> = {}): Promise<string> => {
    const record = await workspaceStore.create({
      name: `WS ${Date.now()}-${Math.random()}`,
      alias: `ws-${newObjectId()}`,
      storagePrefix: `sp-${newObjectId()}`,
      createdBy: OWNER,
      allocatedStorage: 1024,
      ...overrides,
    } as never);
    cleanupWorkspaceIds.push(record.id);
    return record.id;
  };

  afterEach(async () => {
    // sessions/documents/shares cascade from workspaces
    if (cleanupWorkspaceIds.length) {
      await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [...cleanupWorkspaceIds]));
      cleanupWorkspaceIds.length = 0;
    }
    if (cleanupSettingIds.length) {
      await db.delete(schema.workspaceSettings).where(inArray(schema.workspaceSettings.id, [...cleanupSettingIds]));
      cleanupSettingIds.length = 0;
    }
  });
  afterAll(close);

  it('workspace store: create/find/update/counters/access filters', async () => {
    expect(await workspaceStore.backfillStoragePrefixFromAlias()).toBe(0);

    const wsId = await createWorkspace({ name: 'Quota WS', alias: 'quota-ws', storagePrefix: 'quota-ws' });
    const found = await workspaceStore.findById(wsId);
    expect(found).toMatchObject({ id: wsId, createdBy: OWNER, documentCount: 0, shareCount: 0, isSystem: false });
    expect((await workspaceStore.findByIds([wsId, newObjectId()])).size).toBe(1);
    expect(await workspaceStore.countNonSystemByOwner(OWNER)).toBeGreaterThanOrEqual(1);
    expect(await workspaceStore.findByName(OWNER, 'Quota WS')).toMatchObject({ id: wsId });
    expect(await workspaceStore.findByOwnerAndAlias(OWNER, 'quota-ws')).toMatchObject({ id: wsId });
    expect(await workspaceStore.findByOwnerAndAlias(OWNER, 'quota-ws', wsId)).toBeNull();
    expect(await workspaceStore.filterOwned([wsId], OWNER)).toEqual([wsId]);
    expect(await workspaceStore.filterOwned([wsId], USER2)).toEqual([]);
    expect(await workspaceStore.filterPublic([wsId])).toEqual([]);
    expect(await workspaceStore.findIdsByOwner(OWNER)).toContain(wsId);

    const page = await workspaceStore.listByUser(OWNER, { skip: 0, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' });
    expect(page.items.map((w) => w.id)).toContain(wsId);
    expect(page.total).toBeGreaterThanOrEqual(1);

    await workspaceStore.updateFields(wsId, { description: 'updated', settingsId: null, isPublic: true });
    expect(await workspaceStore.findById(wsId)).toMatchObject({ description: 'updated', settingsId: undefined, isPublic: true });

    await documentStore.create({ originalName: 'counter.pdf', mimeType: 'application/pdf', size: 50, workspaceId: wsId, createdBy: OWNER, status: 'completed' });
    await workspaceStore.incrementCounters(wsId, { usedStorage: 50, documentCount: 1, shareCount: 2 });
    expect(await workspaceStore.findById(wsId)).toMatchObject({ usedStorage: 50, documentCount: 1, shareCount: 2 });

    const sysId = await createWorkspace({ name: 'system-conv1', alias: 'system-conv1', storagePrefix: 'system-conv1', isSystem: true });
    expect(await workspaceStore.findSystemWorkspace(OWNER, 'conv1')).toMatchObject({ id: sysId });
    await workspaceStore.deleteSystemWorkspace(sysId);
    expect(await workspaceStore.findById(sysId)).toBeNull();
    await workspaceStore.deleteById(wsId);
    cleanupWorkspaceIds.length = 0;
    expect(await workspaceStore.findById(wsId)).toBeNull();
  });

  it('document store: create/probe/update/metadata/delete', async () => {
    const wsId = await createWorkspace();
    const doc = await documentStore.create({ originalName: 'a.pdf', mimeType: 'application/pdf', size: 10, workspaceId: wsId, createdBy: OWNER, status: 'pending' });
    expect(doc.id).toMatch(/^[0-9a-f]{24}$/);
    expect(await documentStore.findByIdAndWorkspace(doc.id, wsId)).toMatchObject({ id: doc.id });
    expect(await documentStore.originalNameExists(wsId, 'a.pdf')).toBe(true);
    expect(await documentStore.originalNameExists(wsId, 'b.pdf')).toBe(false);
    expect(await documentStore.findByIdsInWorkspace(wsId, [doc.id, newObjectId()])).toHaveLength(1);

    const dup = await documentStore.create({ originalName: 'f1', mimeType: 'folder', size: 0, path: 'folder:x', workspaceId: wsId, createdBy: OWNER, status: 'completed', isFolder: true, folderName: 'f1', parentId: null });
    expect(await documentStore.findFolderDuplicate({ workspaceId: wsId, createdBy: OWNER, folderName: 'f1', parentId: null })).toMatchObject({ id: dup.id });
    expect(await documentStore.findFolderDuplicate({ workspaceId: wsId, createdBy: OWNER, folderName: 'f1', parentId: null, excludeId: dup.id })).toBeNull();
    expect(await documentStore.findChildFolderIds(dup.id)).toEqual([]);

    const uploaded = await documentStore.markUploaded(doc.id, { status: 'completed', uploadedAt: new Date(), url: doc.path ?? undefined, metadata: { deepSearchRequested: 'true' } });
    expect(uploaded).toMatchObject({ status: 'completed', uploadedAt: expect.any(Date), metadata: { deepSearchRequested: 'true' } });
    const patched = await documentStore.updateById(doc.id, { status: 'completed', size: 20 });
    expect(patched).toMatchObject({ status: 'completed', size: 20 });
    const renamed = await documentStore.renameOriginalName(doc.id, 'renamed.pdf');
    expect(renamed).toMatchObject({ originalName: 'renamed.pdf' });
    await documentStore.mergeMetadata(wsId, doc.id, { autoIndexRequested: 'false' });
    expect((await documentStore.findById(doc.id))?.metadata).toEqual({ deepSearchRequested: 'true', autoIndexRequested: 'false' });
    await documentStore.setParent(doc.id, dup.id);
    expect(await documentStore.findDirectChildren(dup.id, wsId)).toHaveLength(1);
    const listing = await documentStore.listByWorkspace(wsId, { status: 'completed', parentId: dup.id, sortBy: 'createdAt', sortOrder: 'desc', skip: 0, limit: 10 });
    expect(listing.total).toBe(1);
    expect((await documentStore.findAllByWorkspaceId(wsId)).length).toBe(2);

    await documentStore.deleteByIdAndWorkspace(dup.id, wsId);
    expect(await documentStore.findById(dup.id)).toBeNull();
    await documentStore.deleteById(doc.id);
  });

  it('share store: create/update/delete + workspace counters stay stored', async () => {
    const wsId = await createWorkspace();
    const share = await shareStore.create({ workspaceId: wsId, ownerId: OWNER, sharedWithUserId: USER2, permission: 'read', sharedBy: OWNER });
    expect(await shareStore.findById(share.id)).toMatchObject({ permission: 'read' });
    expect(await shareStore.findOneByWorkspaceAndUser(wsId, USER2)).toMatchObject({ id: share.id });
    expect(await shareStore.filterSharedWithUser(USER2, [wsId])).toEqual([wsId]);
    expect((await shareStore.findForWorkspace(wsId, 0, 10)).total).toBe(1);
    expect((await shareStore.findSharedWithUser(USER2, 0, 10)).items).toHaveLength(1);

    await shareStore.updatePermission(share.id, 'readwrite');
    expect(await shareStore.findById(share.id)).toMatchObject({ permission: 'readwrite' });

    await shareStore.deleteById(share.id);
    expect(await shareStore.findById(share.id)).toBeNull();
    expect(await shareStore.deleteManyByWorkspace(wsId)).toBe(0);
  });

  it('setting store: create/find/list/update/delete', async () => {
    const setting = await settingStore.create({
      name: 'S1', createdBy: OWNER, isTemplate: false, isPredefined: false,
      chunks: 7, hybridSearch: false, ragType: 'standard', maxToken: 4096, topK: 10,
    });
    cleanupSettingIds.push(setting.id);
    expect(await settingStore.findById(setting.id)).toMatchObject({ name: 'S1', chunks: 7 });
    expect((await settingStore.listByUser(OWNER, { search: 'S1', skip: 0, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' })).total).toBe(1);
    expect((await settingStore.listTemplates({ skip: 0, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' })).items.map((s) => s.id)).not.toContain(setting.id);

    await settingStore.updateFields(setting.id, { instruction: 'be nice', chunks: 9 });
    expect(await settingStore.findById(setting.id)).toMatchObject({ instruction: 'be nice', chunks: 9 });

    await settingStore.deleteById(setting.id);
    expect(await settingStore.findById(setting.id)).toBeNull();
    cleanupSettingIds.length = 0;
  });

  it('upload session store: create with files, per-file progress, expiry, delete by workspace', async () => {
    const wsId = await createWorkspace();
    const doc = await documentStore.create({ originalName: 'bulk.pdf', mimeType: 'application/pdf', size: 10, workspaceId: wsId, createdBy: OWNER, status: 'pending' });
    const session = await sessionStore.create({
      workspaceId: wsId,
      userId: OWNER,
      status: 'pending',
      files: [
        { index: 0, filename: 'bulk.pdf', mimeType: 'application/pdf', size: 10, documentId: doc.id, uploadUrl: 'https://x', status: 'pending', progress: 0 },
        { index: 1, filename: 'b.pdf', mimeType: 'application/pdf', size: 5, status: 'pending', progress: 0 },
      ],
      totalFiles: 2,
      totalSize: 15,
      completedFiles: 0,
      failedFiles: 0,
      expiresAt: new Date(Date.now() - 1000),
    });

    const found = await sessionStore.findByIdWorkspaceUser(session.id, wsId, OWNER);
    expect(found?.files.map((f) => f.index)).toEqual([0, 1]);
    expect(await sessionStore.findByIdWorkspaceUser(session.id, wsId, USER2)).toBeNull();

    await sessionStore.updateFileProgress(session.id, 1, { status: 'completed', progress: 100 });
    await sessionStore.setStatus(session.id, 'in_progress');
    let after = await sessionStore.findByIdWorkspaceUser(session.id, wsId, OWNER);
    expect(after).toMatchObject({ status: 'in_progress' });
    expect(after?.files[1]).toMatchObject({ status: 'completed', progress: 100 });
    expect(after?.files[0]).toMatchObject({ status: 'pending', progress: 0 });

    await sessionStore.setOutcome(session.id, { status: 'completed', completedFiles: 1, failedFiles: 1 });
    expect(await sessionStore.findByIdWorkspaceUser(session.id, wsId, OWNER)).toMatchObject({ completedFiles: 1, failedFiles: 1 });

    await sessionStore.markExpired(session.id);
    after = await sessionStore.findByIdWorkspaceUser(session.id, wsId, OWNER);
    expect(after).toMatchObject({ status: 'expired' });

    // expired but already terminal → findExpired must NOT return it
    await sessionStore.setStatus(session.id, 'in_progress');
    await sessionStore.markExpired(session.id);
    const expired = await sessionStore.findExpired(new Date());
    expect(expired.map((s) => s.id)).not.toContain(session.id);
    await sessionStore.setStatus(session.id, 'pending');
    expect((await sessionStore.findExpired(new Date())).map((s) => s.id)).toContain(session.id);

    const wsId2 = await createWorkspace();
    const session2 = await sessionStore.create({
      workspaceId: wsId2, userId: OWNER, status: 'pending',
      files: [{ index: 0, filename: 'z.pdf', mimeType: 'application/pdf', size: 1, status: 'pending', progress: 0 }],
      totalFiles: 1, totalSize: 1, completedFiles: 0, failedFiles: 0,
      expiresAt: new Date(Date.now() - 1000),
    });
    await sessionStore.deleteManyByWorkspace(wsId2);
    expect(await sessionStore.findByIdWorkspaceUser(session2.id, wsId2, OWNER)).toBeNull();

    // cascade check: children gone with the session
    await db.delete(schema.uploadSessions).where(eq(schema.uploadSessions.id, session.id));
    expect(await sessionStore.findByIdWorkspaceUser(session.id, wsId, OWNER)).toBeNull();
  });
});
