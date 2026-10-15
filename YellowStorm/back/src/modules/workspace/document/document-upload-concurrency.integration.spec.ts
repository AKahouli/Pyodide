import { inArray } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '@modules/postgres/testing/pg-integration';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { PgDocumentStore } from '../stores/postgres/pg-document-store';
import { PgWorkspaceStore } from '../stores/postgres/pg-workspace-store';
import { PgUploadSessionStore } from '../stores/postgres/pg-upload-session-store';
import { WorkspaceDocumentWrite } from './document-write';
import { WorkspaceDocumentUploadSessions } from './document-upload-sessions';
import { WorkspaceDocumentSupport } from './document-support';

describeIntegration('simultaneous upload lifecycle', () => {
  const { db, close } = makeTestDb();
  const documents = new PgDocumentStore(db);
  const workspaces = new PgWorkspaceStore(db);
  const sessions = new PgUploadSessionStore(db);
  const owner = 'a1a1a1a1a1a1a1a1a1a1a1a1';
  const fixtures: string[] = [];
  const logger = { setContext: jest.fn(), debug: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const config = { get: (_key: string, fallback: unknown) => fallback };

  async function setup(quota = 1024) {
    const workspace = await workspaces.create({ name: 'Upload concurrency QA', alias: newObjectId(),
      storagePrefix: newObjectId(), createdBy: owner, allocatedStorage: quota });
    fixtures.push(workspace.id);
    const blobs = new Map<string, Buffer>();
    const storage = {
      upload: jest.fn(async (file: Buffer, _name: string, _mime: string,
        options: { folder: string; customFileName: string }) => {
        const path = `${options.folder}/${options.customFileName}`;
        blobs.set(path, Buffer.from(file));
        return { storedName: options.customFileName, blobPath: path, url: path, contentHash: 'qa' };
      }),
      generateSasUrl: jest.fn(async (path: string) => `https://example.invalid/${path}`),
      exists: jest.fn(async () => true),
      delete: jest.fn(async (path: string) => { blobs.delete(path); }),
    };
    const support = new WorkspaceDocumentSupport(documents, {
      getAllowedExtensions: async () => ['.png'], getAllowedMimeTypesForExtension: () => ['image/png'],
      getSettings: async () => ({ maxFileSizeMb: 500 }),
    } as never, config as never, { sendToUser: async () => undefined } as never, logger as never);
    const workspaceService = {
      checkStorageQuota: async (_id: string, size: number) => {
        const current = (await workspaces.findById(workspace.id))!;
        return { allowed: size <= current.allocatedStorage - current.usedStorage,
          available: current.allocatedStorage - current.usedStorage };
      },
      getStorageContext: async () => ({ ownerUserId: owner, storagePrefix: workspace.storagePrefix }),
      updateStorageUsage: (id: string, usedStorage: number, documentCount: number) =>
        workspaces.incrementCounters(id, { usedStorage, documentCount }),
    };
    const indexing = { queueDocument: jest.fn(async () => undefined) };
    const write = new WorkspaceDocumentWrite(documents, workspaceService as never, storage as never,
      indexing as never, config as never, {} as never, support, logger as never);
    const bulk = new WorkspaceDocumentUploadSessions(documents, sessions, workspaceService as never,
      storage as never, indexing as never, config as never, support, logger as never);
    return { workspace, blobs, storage, write, bulk };
  }

  afterEach(async () => {
    if (fixtures.length) await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, fixtures.splice(0)));
  });
  afterAll(close);

  it('simultaneous direct uploads reserve before blob writes and reject the overflow', async () => {
    const t = await setup();
    const results = await Promise.allSettled(['a.png', 'b.png'].map(name =>
      t.write.uploadSmallFile(t.workspace.id, owner, Buffer.alloc(700), name, 'image/png', undefined, false, false)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(t.storage.upload).toHaveBeenCalledTimes(1);
    expect(await workspaces.findById(t.workspace.id)).toMatchObject({ usedStorage: 700, documentCount: 1 });
  });

  it('simultaneous names that sanitize identically keep distinct stored bytes and survive reload', async () => {
    const t = await setup();
    const files = [Buffer.from('first image'), Buffer.from('second image')];
    const saved = await Promise.all(['a b.png', 'a_b.png'].map((name, index) =>
      t.write.uploadSmallFile(t.workspace.id, owner, files[index], name, 'image/png', undefined, false, false)));
    expect(saved.map(d => d.originalName)).toEqual(['a b.png', 'a_b.png']);
    expect(saved[0].path).not.toBe(saved[1].path);
    const reloaded = new PgDocumentStore(db);
    for (let index = 0; index < saved.length; index++) {
      const document = (await reloaded.findById(saved[index].id))!;
      expect(document.path).toBe(`${owner}/${t.workspace.storagePrefix}/${document.id}-a_b.png`);
      expect(t.blobs.get(document.path!)).toEqual(files[index]);
    }
  });

  it('simultaneous single confirmations and retries account exactly once', async () => {
    const t = await setup();
    const pending = await t.write.requestUploadUrl(t.workspace.id, owner,
      { filename: 'single.png', mimeType: 'image/png', size: 700 });
    const results = await Promise.all([1, 2, 3].map(() =>
      t.write.confirmUpload(t.workspace.id, owner, pending.documentId, false, { autoIndex: false })));
    expect(results.every(d => d.id === pending.documentId && d.status === 'completed')).toBe(true);
    expect(await workspaces.findById(t.workspace.id)).toMatchObject({ usedStorage: 700, documentCount: 1 });
    await t.write.confirmUpload(t.workspace.id, owner, pending.documentId, false, { autoIndex: false });
    expect(await workspaces.findById(t.workspace.id)).toMatchObject({ usedStorage: 700, documentCount: 1 });
  });

  it('simultaneous bulk completion and retry account each file once', async () => {
    const t = await setup();
    const pending = await t.bulk.initiateBulkUpload(t.workspace.id, owner, { files: [
      { filename: 'a b.png', mimeType: 'image/png', size: 300 },
      { filename: 'a_b.png', mimeType: 'image/png', size: 300 },
    ] });
    expect(pending.files[0].uploadUrl).not.toBe(pending.files[1].uploadUrl);
    const outcomes = await Promise.all([1, 2].map(() =>
      t.bulk.completeBulkUpload(t.workspace.id, owner, pending.sessionId, false, false)));
    expect(outcomes.every(o => o.successful.count === 2)).toBe(true);
    t.storage.exists.mockResolvedValue(false); // A replay must not delete an already completed file.
    await t.bulk.completeBulkUpload(t.workspace.id, owner, pending.sessionId, false, false);
    expect(await documents.findAllByWorkspaceId(t.workspace.id)).toHaveLength(2);
    expect(await workspaces.findById(t.workspace.id)).toMatchObject({ usedStorage: 600, documentCount: 2 });
  });

  it('expired single reservations are released while live URLs and completed files are preserved', async () => {
    const t = await setup();
    const expired = await t.write.requestUploadUrl(t.workspace.id, owner,
      { filename: 'expired.png', mimeType: 'image/png', size: 700 });
    const live = await t.write.requestUploadUrl(t.workspace.id, owner,
      { filename: 'live.png', mimeType: 'image/png', size: 100 });
    await documents.mergeMetadata(t.workspace.id, expired.documentId,
      { uploadExpiresAt: new Date(Date.now() - 60000).toISOString() });
    const findExpired = documents.findExpiredPendingUploads.bind(documents);
    const scoped = jest.spyOn(documents, 'findExpiredPendingUploads').mockImplementationOnce(async (now, before) =>
      (await findExpired(now, before)).filter(d => d.workspaceId === t.workspace.id));
    const sessionScope = jest.spyOn(sessions, 'findExpired').mockResolvedValueOnce([]);
    await t.bulk.cleanupExpiredSessions();
    scoped.mockRestore(); sessionScope.mockRestore();
    expect(await documents.findById(expired.documentId)).toBeNull();
    expect(await documents.findById(live.documentId)).not.toBeNull();
    expect(t.storage.delete).toHaveBeenCalledTimes(1);
    await t.write.confirmUpload(t.workspace.id, owner, live.documentId, false, { autoIndex: false });
    // A cleanup worker holding an old PENDING snapshot cannot delete this completed row.
    expect(await documents.deletePendingUpload(live.documentId, t.workspace.id)).toBeNull();
    expect(await documents.findById(live.documentId)).toMatchObject({ status: 'completed' });
    await expect(t.write.requestUploadUrl(t.workspace.id, owner,
      { filename: 'retry.png', mimeType: 'image/png', size: 700 })).resolves.toBeDefined();
  });

  it('URL issuance failures and partial bulk initialization release pending reservations', async () => {
    const t = await setup();
    t.storage.generateSasUrl.mockRejectedValueOnce(new Error('signer failed'));
    await expect(t.write.requestUploadUrl(t.workspace.id, owner,
      { filename: 'single.png', mimeType: 'image/png', size: 700 })).rejects.toThrow('signer failed');
    expect(await documents.findAllByWorkspaceId(t.workspace.id)).toHaveLength(0);
    t.storage.generateSasUrl.mockResolvedValueOnce('https://example.invalid/a').mockRejectedValueOnce(new Error('signer failed'));
    await expect(t.bulk.initiateBulkUpload(t.workspace.id, owner, { files: [
      { filename: 'a.png', mimeType: 'image/png', size: 300 },
      { filename: 'b.png', mimeType: 'image/png', size: 300 },
    ] })).rejects.toThrow('signer failed');
    expect(await documents.findAllByWorkspaceId(t.workspace.id)).toHaveLength(0);
  });
});
