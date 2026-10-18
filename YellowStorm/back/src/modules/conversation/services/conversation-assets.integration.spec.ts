import { Readable } from 'node:stream';
import { inArray } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '@modules/postgres/testing/pg-integration';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { PgDocumentStore } from '../../workspace/stores/postgres/pg-document-store';
import { PgWorkspaceStore } from '../../workspace/stores/postgres/pg-workspace-store';
import { WorkspaceDocumentWrite } from '../../workspace/document/document-write';
import { WorkspaceDocumentSupport } from '../../workspace/document/document-support';
import { ConversationArtifactService } from './conversation-artifact.service';

describeIntegration('conversation output registration transactions', () => {
  const { db, close } = makeTestDb();
  const documents = new PgDocumentStore(db);
  const workspaces = new PgWorkspaceStore(db);
  const fixtures: string[] = [];
  const actor = 'a1'.repeat(12);
  const conversationId = 'b2'.repeat(12);
  const output = { userId: actor, conversationId, invocationId: 'turn-1', sourcePath: `${actor}/system_${conversationId}/outputs/report.docx`,
    fileName: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

  async function setup(quota = 1024) {
    const workspace = await workspaces.create({ name: `Conversation output QA ${newObjectId()}`, alias: newObjectId(), storagePrefix: newObjectId(), createdBy: actor, allocatedStorage: quota });
    fixtures.push(workspace.id);
    const blobs = new Map<string, Buffer>();
    const logger = { setContext: jest.fn(), debug: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const config = { get: (_key: string, fallback: unknown) => fallback };
    const storage = {
      openReadStream: async () => ({ body: Readable.from([Buffer.from('office bytes')]) }),
      upload: jest.fn(async (bytes: Buffer, _name: string, _mime: string, options: { folder: string; customFileName: string }) => {
        const path = `${options.folder}/${options.customFileName}`;
        blobs.set(path, bytes);
        return { storedName: options.customFileName, blobPath: path, url: path, contentHash: 'qa' };
      }),
      delete: jest.fn(async (path: string) => { blobs.delete(path); }),
    };
    const support = new WorkspaceDocumentSupport(documents, {
      getAllowedExtensions: async () => ['.docx'], getAllowedMimeTypesForExtension: () => [output.mimeType],
      getSettings: async () => ({ maxFileSizeMb: 50 }),
    } as never, config as never, { sendToUser: async () => undefined } as never, logger as never);
    const workspaceService = {
      checkStorageQuota: async (_id: string, size: number) => {
        const current = (await workspaces.findById(workspace.id))!;
        return { allowed: size <= current.allocatedStorage - current.usedStorage, available: current.allocatedStorage - current.usedStorage };
      },
      getStorageContext: async () => ({ ownerUserId: actor, storagePrefix: workspace.storagePrefix }),
      updateStorageUsage: (id: string, usedStorage: number, documentCount: number) => workspaces.incrementCounters(id, { usedStorage, documentCount }),
    };
    const write = new WorkspaceDocumentWrite(documents, workspaceService as never, storage as never,
      { queueDocument: jest.fn() } as never, config as never, {} as never, support, logger as never);
    const metadata = jest.fn((workspaceId: string, id: string, patch: Record<string, string>) => documents.mergeMetadata(workspaceId, id, patch));
    const workspaceDocuments = { uploadSmallFile: write.uploadSmallFile.bind(write), mergeMetadata: metadata,
      findById: async (workspaceId: string, id: string) => documents.findByIdAndWorkspace(id, workspaceId) };
    const conversations = { requireCurrentParticipant: async () => ({ createdBy: actor, systemWorkspaceId: workspace.id }) };
    const service = new ConversationArtifactService({} as never, storage as never, conversations as never, workspaceDocuments as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, documents);
    return { service, workspace, blobs, storage, metadata };
  }

  afterEach(async () => {
    if (fixtures.length) await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, fixtures.splice(0)));
  });
  afterAll(close);

  it('serializes simultaneous retries into one document and charges bytes once', async () => {
    const t = await setup();
    const results = await Promise.all([t.service.registerAsset(output), t.service.registerAsset(output)]);
    expect(results[0].documentId).toBe(results[1].documentId);
    expect(await documents.findAllByWorkspaceId(t.workspace.id)).toHaveLength(1);
    expect(t.storage.upload).toHaveBeenCalledTimes(1);
    expect(await workspaces.findById(t.workspace.id)).toMatchObject({ usedStorage: 12, documentCount: 1 });
  });

  it('rolls back row and quota and cleans the blob if provenance publication fails', async () => {
    const t = await setup();
    t.metadata.mockRejectedValueOnce(new Error('metadata failure'));
    await expect(t.service.registerAsset(output)).rejects.toThrow('metadata failure');
    expect(await documents.findAllByWorkspaceId(t.workspace.id)).toHaveLength(0);
    expect(await workspaces.findById(t.workspace.id)).toMatchObject({ usedStorage: 0, documentCount: 0 });
    expect(t.blobs.size).toBe(0);
    expect((await t.service.registerAsset(output)).documentId).toBeTruthy();
  });

  it('publishes no document or blob when quota rejects the output', async () => {
    const t = await setup(1);
    await expect(t.service.registerAsset(output)).rejects.toThrow('Insufficient storage');
    expect(await documents.findAllByWorkspaceId(t.workspace.id)).toHaveLength(0);
    expect(t.storage.upload).not.toHaveBeenCalled();
  });

  it('searches friendly output names with literal wildcard characters and current workspace scope', async () => {
    const t = await setup();
    const other = await setup();
    const registered = await t.service.registerAsset({ ...output, fileName: 'Report_100%.docx' });
    const query = { search: 'report_100%', skip: 0, limit: 10, sortBy: 'originalName', sortOrder: 'asc' as const };
    const single = await documents.listByWorkspace(t.workspace.id, query);
    const multiple = await documents.listByWorkspaces([t.workspace.id], { ...query, searchFilename: true });
    expect(single.items.map(d => d.id)).toEqual([registered.documentId]);
    expect(single.total).toBe(1);
    expect(multiple.items.map(d => d.id)).toEqual([registered.documentId]);
    expect((await documents.listByWorkspaces([t.workspace.id], { ...query, searchFilename: false })).total).toBe(1);
    expect((await documents.listByWorkspace(other.workspace.id, query)).items).toEqual([]);
    expect((await documents.listByWorkspace(t.workspace.id, { ...query, search: 'report_100X' })).items).toEqual([]);
  });
});
