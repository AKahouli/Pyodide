import { Readable } from 'node:stream';
import { eq, inArray } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '@modules/postgres/testing/pg-integration';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { PgDocumentStore } from '../../workspace/stores/postgres/pg-document-store';
import { PgWorkspaceStore } from '../../workspace/stores/postgres/pg-workspace-store';
import { WorkspaceDocumentWrite } from '../../workspace/document/document-write';
import { WorkspaceDocumentSupport } from '../../workspace/document/document-support';
import { ConversationArtifactService } from './conversation-artifact.service';
import { WorkspaceDocumentTree } from '../../workspace/document/document-tree';
import { WorkspaceDocumentRead } from '../../workspace/document/document-read';
import { PostgresMessageStore } from '../persistence/postgres/postgres-message-store';
import { PgWorkspaceDocumentReadAdapter } from '../../workspace/persistence/postgres/pg-workspace-document-read.adapter';
import { PgWorkspaceDocumentWriteAdapter } from '../../workspace/persistence/postgres/pg-workspace-document-write.adapter';

describeIntegration('conversation output registration transactions', () => {
  const { db, close } = makeTestDb();
  const documents = new PgDocumentStore(db);
  const workspaces = new PgWorkspaceStore(db);
  const messages = new PostgresMessageStore(db);
  const fixtures: string[] = [];
  const actor = 'a1'.repeat(12);
  const conversationId = 'b2'.repeat(12);
  const output = { userId: actor, conversationId, invocationId: 'turn-1', sourcePath: `${actor}/system_${conversationId}/outputs/report.docx`,
    fileName: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

  async function setup(quota = 1024, fixtureActor = actor, fixtureConversationId = conversationId) {
    const workspace = await workspaces.create({ name: `Conversation output QA ${newObjectId()}`, alias: newObjectId(), storagePrefix: newObjectId(), createdBy: fixtureActor, allocatedStorage: quota });
    fixtures.push(workspace.id);
    const blobs = new Map<string, Buffer>();
    const logger = { setContext: jest.fn(), debug: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const config = { get: (_key: string, fallback: unknown) => fallback };
    const storage = {
      openReadStream: async (path: string) => ({ body: Readable.from([blobs.get(path) ?? Buffer.from('office bytes')]) }),
      exists: async (path: string) => blobs.has(path),
      upload: jest.fn(async (bytes: Buffer, _name: string, _mime: string, options: { folder: string; customFileName: string }) => {
        const path = `${options.folder}/${options.customFileName}`;
        blobs.set(path, bytes);
        return { storedName: options.customFileName, blobPath: path, url: path, contentHash: 'qa' };
      }),
      delete: jest.fn(async (path: string) => { blobs.delete(path); }),
      copy: jest.fn(async (source: string, destination: string) => {
        const bytes = blobs.get(source);
        if (!bytes) throw new Error('missing source');
        blobs.set(destination, Buffer.from(bytes));
        return destination;
      }),
    };
    const support = new WorkspaceDocumentSupport(documents, {
      getAllowedExtensions: async () => ['.docx', '.png'], getAllowedMimeTypesForExtension: (extension: string) => extension === '.png' ? ['image/png'] : [output.mimeType],
      getSettings: async () => ({ maxFileSizeMb: 50 }),
    } as never, config as never, { sendToUser: async () => undefined } as never, logger as never);
    const workspaceService = {
      checkStorageQuota: async (_id: string, size: number) => {
        const current = (await workspaces.findById(workspace.id))!;
        return { allowed: size <= current.allocatedStorage - current.usedStorage, available: current.allocatedStorage - current.usedStorage };
      },
      getStorageContext: async () => ({ ownerUserId: fixtureActor, storagePrefix: workspace.storagePrefix }),
      updateStorageUsage: (id: string, usedStorage: number, documentCount: number) => workspaces.incrementCounters(id, { usedStorage, documentCount }),
    };
    const write = new WorkspaceDocumentWrite(documents, workspaceService as never, storage as never,
      { queueDocument: jest.fn() } as never, config as never, {} as never, support, logger as never);
    const metadata = jest.fn((workspaceId: string, id: string, patch: Record<string, string>) => documents.mergeMetadata(workspaceId, id, patch));
    const indexing = { deleteDocumentIndex: jest.fn(async () => undefined) };
    const tree = new WorkspaceDocumentTree(documents, {} as never, workspaceService as never, storage as never, indexing as never,
      { countBySource: async () => 0 } as never, support, logger as never);
    const read = new WorkspaceDocumentRead(documents, storage as never, config as never, support, logger as never);
    const workspaceDocuments = { uploadSmallFile: write.uploadSmallFile.bind(write), mergeMetadata: metadata,
      findById: read.findById.bind(read), deleteConversationAsset: tree.deleteConversationAsset.bind(tree), getDownloadUrl: read.getDownloadUrl.bind(read) };
    const conversations = { requireCurrentParticipant: async (_id: string, userId: string) => {
      if (userId !== fixtureActor || _id !== fixtureConversationId) throw new Error('current membership');
      return { createdBy: fixtureActor, systemWorkspaceId: workspace.id };
    }, filterAccessibleWorkspaceIds: async () => [], getUploadedDocuments: async (_id: string, query: object) => read.findByMultipleWorkspaces([workspace.id], query),
      getWorkspaceDocuments: async () => ({ documents: [], pagination: { totalPages: 0 } }) };
    const messageService = { getAssetRevocationState: messages.getAssetRevocationState.bind(messages), markDocumentArtifactsUnavailable: messages.markDocumentArtifactsUnavailable.bind(messages),
      listPendingAssetCleanup: messages.listPendingAssetCleanup.bind(messages), markAssetUnavailable: messages.markAssetUnavailable.bind(messages),
      getMessageDocument: messages.findById.bind(messages), setAssetCleanup: messages.setAssetCleanup.bind(messages), listRecentArtifactMessages: messages.listRecentArtifactMessages.bind(messages) };
    const settings = { isAttachmentIntelligenceEnabled: async () => true };
    const service = new ConversationArtifactService(messageService as never, storage as never, conversations as never, workspaceDocuments as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, settings as never, undefined, documents);
    return { service, workspace, blobs, storage, metadata, indexing, tree, read, write };
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

  it('deletes concurrently once, frees admission quota, removes staged aliases and denies every new read', async () => {
    const t = await setup(12);
    const outputReceipt = await t.service.registerAsset(output);
    const staged = await t.service.prepareAsset(conversationId, actor, outputReceipt.asset.ref, 'turn-2');
    const stagedPath = `${actor}/system_${conversationId}/${staged.sandboxPath.replace('/mnt/workspace/', '')}`;
    expect(t.blobs.has(stagedPath)).toBe(true);
    const before = await t.service.assetRevocationState(conversationId, actor);
    const deleted = await Promise.all([t.service.deleteAsset(conversationId, actor, outputReceipt.asset.ref), t.service.deleteAsset(conversationId, actor, outputReceipt.asset.ref)]);
    expect(deleted.filter(result => !result.alreadyDeleted)).toHaveLength(1);
    expect(t.blobs.has(stagedPath)).toBe(false);
    expect(t.blobs.has(outputReceipt.storagePath)).toBe(false);
    expect(await workspaces.findById(t.workspace.id)).toMatchObject({ usedStorage: 0, documentCount: 0 });
    const after = await t.service.assetRevocationState(conversationId, actor);
    expect(after.epoch).not.toBe(before.epoch);
    expect(after.cleanupPending).toBe(false);
    const readPort = new PgWorkspaceDocumentReadAdapter(db);
    expect(await readPort.findById(outputReceipt.documentId)).toBeNull();
    expect(await readPort.findOne({ id: outputReceipt.documentId })).toBeNull();
    expect(await readPort.countDocuments({ workspaceId: t.workspace.id })).toBe(0);
    expect(await readPort.findOne({ id: outputReceipt.documentId, includeDeleted: true })).toMatchObject({ id: outputReceipt.documentId });
    await new PgWorkspaceDocumentWriteAdapter(db).updateIndexingState(outputReceipt.documentId, {
      status: 'completed', indexingStatus: 'ready', metadata: { staleWorker: 'must not erase tombstone' },
    });
    expect((await documents.findById(outputReceipt.documentId))?.metadata?.assetDeletedAt).toBeTruthy();
    expect(await readPort.findById(outputReceipt.documentId)).toBeNull();
    expect((await t.service.deleteAsset(conversationId, actor, outputReceipt.asset.ref)).alreadyDeleted).toBe(true);
    expect((await t.service.assetRevocationState(conversationId, actor)).epoch).toBe(after.epoch);
    for (const operation of [() => t.service.inspectAsset(conversationId, actor, outputReceipt.asset.ref), () => t.service.readAsset(conversationId, actor, outputReceipt.asset.ref),
      () => t.service.prepareAsset(conversationId, actor, outputReceipt.asset.ref, 'turn-3'), () => t.read.getDownloadUrl(t.workspace.id, outputReceipt.documentId)]) await expect(operation()).rejects.toThrow();
    await expect(t.service.deleteAsset(conversationId, 'b1'.repeat(12), outputReceipt.asset.ref)).rejects.toThrow('current membership');
    await expect(t.service.registerAsset({ ...output, invocationId: 'turn-3' })).rejects.toThrow('Sandbox asset access changed');
    const replacement = await t.service.registerAsset({ ...output, invocationId: 'turn-3', sandboxEpoch: after.epoch });
    expect(replacement.documentId).not.toBe(outputReceipt.documentId);
    expect(await workspaces.findById(t.workspace.id)).toMatchObject({ usedStorage: 12, documentCount: 1 });
  });

  it('restores pending cleanup separately after reload, retries without another refund, and preserves a newer raw source', async () => {
    const t = await setup();
    const receipt = await t.service.registerAsset(output);
    t.blobs.set(output.sourcePath, Buffer.from('a newer run replaced this mutable filename'));
    t.storage.delete.mockRejectedValueOnce(new Error('storage offline'));
    const deleted = await t.service.deleteAsset(conversationId, actor, receipt.asset.ref);
    expect(deleted.cleanup.blob).toBe('pending');
    expect((await t.service.assetRevocationState(conversationId, actor)).cleanupPending).toBe(true);
    const list = await t.service.listAssets(conversationId, actor);
    expect(list.assets).toEqual([]);
    expect(list.pendingCleanup?.[0]).toMatchObject({ ref: receipt.asset.ref, status: 'deleted', actions: { delete: true, read: false } });
    expect(JSON.stringify(list)).not.toContain(receipt.storagePath);
    expect((await t.service.deleteAsset(conversationId, actor, receipt.asset.ref)).cleanup.blob).toBe('done');
    expect(t.blobs.get(output.sourcePath)?.toString()).toBe('a newer run replaced this mutable filename');
    expect((await t.service.assetRevocationState(conversationId, actor)).cleanupPending).toBe(false);
    expect((await t.service.listAssets(conversationId, actor)).pendingCleanup).toBeUndefined();
    expect(await workspaces.findById(t.workspace.id)).toMatchObject({ usedStorage: 0, documentCount: 0 });
  });

  it('uses source-match component updates without overwriting unrelated content and removes app source from saved history', async () => {
    const t = await setup();
    const messageId = newObjectId();
    const component = { id: 'app', type: 'text' as const, data: { content: 'root = Card("Private app")' } };
    const other = { id: 'other', type: 'text' as const, data: { content: 'Keep this text' } };
    await db.insert(schema.conversations).values({ id: conversationId, createdBy: actor });
    try {
      await db.insert(schema.messages).values({ id: messageId, conversationId, conversationType: 'ai', isComplete: true, isStreaming: false,
        content: `${component.data.content}\nKeep this text`, components: [component, other] });
      expect(await messages.markAssetUnavailable(conversationId, messageId, { ...component, data: { content: 'wrong version' } })).toBe(false);
      expect(await messages.markAssetUnavailable(conversationId, messageId, component)).toBe(true);
      const row = await messages.findById(messageId);
      expect(row?.components?.[1]).toEqual(other);
      expect(row?.components?.[0].data).toMatchObject({ content: '', availability: 'deleted' });
      expect(row?.content).not.toContain('root =');
      expect(row?.content).toContain('Keep this text');
      const ref = Buffer.from(JSON.stringify(['app', messageId, 'app'])).toString('base64url');
      await expect(t.service.readAsset(conversationId, actor, ref)).rejects.toThrow('Asset not found');
      expect((await t.service.deleteAsset(conversationId, actor, ref)).alreadyDeleted).toBe(true);
    } finally { await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId)); }
  });

  it('removes the existing image-preparation cache and rejects staging from a stale image snapshot after deletion', async () => {
    const t = await setup();
    const image = await t.write.uploadSmallFile(t.workspace.id, actor, Buffer.from('image bytes'), 'generated-image.png', 'image/png', undefined, false, false);
    const imageStage = t.service as unknown as { stageGeneratedImage(request: { userId: string; conversationId: string }, sourceImage: typeof image): Promise<{ sandboxPath: string }> };
    const staged = await imageStage.stageGeneratedImage({ userId: actor, conversationId }, image);
    const path = `${actor}/system_${conversationId}/${staged.sandboxPath.replace('/mnt/workspace/', '')}`;
    expect(t.blobs.has(path)).toBe(true);
    const ref = Buffer.from(JSON.stringify(['document', t.workspace.id, image.id])).toString('base64url');
    expect((await t.service.deleteAsset(conversationId, actor, ref)).cleanup.blob).toBe('done');
    expect(t.blobs.has(path)).toBe(false);
    await expect(imageStage.stageGeneratedImage({ userId: actor, conversationId }, image)).rejects.toThrow('Document not found');
  });

  it('rejects output publication when deletion was acknowledged while the MCP output was being read', async () => {
    const t = await setup();
    const input = await t.write.uploadSmallFile(t.workspace.id, actor, Buffer.from('input bytes'), 'input.docx', output.mimeType, undefined, false, false);
    const ref = Buffer.from(JSON.stringify(['document', t.workspace.id, input.id])).toString('base64url');
    const staged = await t.service.prepareAsset(conversationId, actor, ref, 'turn');
    const originalRead = t.storage.openReadStream;
    let release!: () => void; let started!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const reading = new Promise<void>(resolve => { started = resolve; });
    t.storage.openReadStream = async path => {
      if (path === output.sourcePath) { started(); await barrier; }
      return originalRead(path);
    };
    const publication = t.service.registerAsset({ ...output, inputReceipts: [{ ref, sha256: staged.sha256 }] });
    await reading;
    await t.service.deleteAsset(conversationId, actor, ref);
    release();
    await expect(publication).rejects.toThrow('Sandbox asset access changed');
    expect((await documents.findAllByWorkspaceId(t.workspace.id)).filter(document => !document.metadata?.assetDeletedAt)).toEqual([]);
  });

  it('isolates two actors through concurrent same-name uploads, output registration and deletion', async () => {
    const otherActor = newObjectId(), otherConversation = newObjectId();
    const [a, b] = await Promise.all([setup(), setup(1024, otherActor, otherConversation)]);
    const inputA = Buffer.from('ALPHA private input'), inputB = Buffer.from('BETA private input');
    const [uploadA, uploadB] = await Promise.all([
      a.write.uploadSmallFile(a.workspace.id, actor, inputA, 'same.docx', output.mimeType, undefined, false, false),
      b.write.uploadSmallFile(b.workspace.id, otherActor, inputB, 'same.docx', output.mimeType, undefined, false, false),
    ]);
    const refA = Buffer.from(JSON.stringify(['document', a.workspace.id, uploadA.id])).toString('base64url');
    const refB = Buffer.from(JSON.stringify(['document', b.workspace.id, uploadB.id])).toString('base64url');
    expect(refA).not.toBe(refB);
    const [stagedA, stagedB] = await Promise.all([
      a.service.prepareAsset(conversationId, actor, refA, 'same-turn', true),
      b.service.prepareAsset(otherConversation, otherActor, refB, 'same-turn', true),
    ]);
    expect(Buffer.from(stagedA.contentBase64!, 'base64')).toEqual(inputA);
    expect(Buffer.from(stagedB.contentBase64!, 'base64')).toEqual(inputB);
    const requestB = { ...output, userId: otherActor, conversationId: otherConversation,
      sourcePath: `${otherActor}/system_${otherConversation}/outputs/same.docx`, fileName: 'same.docx' };
    a.blobs.set(output.sourcePath, Buffer.from('ALPHA generated output'));
    b.blobs.set(requestB.sourcePath, Buffer.from('BETA generated output'));
    const [generatedA, generatedB] = await Promise.all([
      a.service.registerAsset({ ...output, fileName: 'same.docx', inputReceipts: [{ ref: refA, sha256: stagedA.sha256 }] }),
      b.service.registerAsset({ ...requestB, inputReceipts: [{ ref: refB, sha256: stagedB.sha256 }] }),
    ]);
    expect(generatedA.asset.ref).not.toBe(generatedB.asset.ref);
    expect(a.blobs.get(generatedA.storagePath)?.toString()).toBe('ALPHA generated output');
    expect(b.blobs.get(generatedB.storagePath)?.toString()).toBe('BETA generated output');
    await expect(b.service.deleteAsset(otherConversation, otherActor, refA)).rejects.toThrow('Asset not found');
    await expect(b.service.deleteAsset(conversationId, otherActor, generatedA.asset.ref)).rejects.toThrow('current membership');
    const quotaB = await workspaces.findById(b.workspace.id);
    const epochB = await b.service.assetRevocationState(otherConversation, otherActor);
    const [, retainedB] = await Promise.all([
      a.service.deleteAsset(conversationId, actor, refA),
      b.service.prepareAsset(otherConversation, otherActor, generatedB.asset.ref, 'after-reload', true),
    ]);
    expect(Buffer.from(retainedB.contentBase64!, 'base64').toString()).toBe('BETA generated output');
    expect(await b.service.assetRevocationState(otherConversation, otherActor)).toEqual(epochB);
    expect(await workspaces.findById(b.workspace.id)).toMatchObject({ usedStorage: quotaB!.usedStorage, documentCount: quotaB!.documentCount });
    await a.service.deleteAsset(conversationId, actor, generatedA.asset.ref);
    expect(await workspaces.findById(a.workspace.id)).toMatchObject({ usedStorage: 0, documentCount: 0 });
    expect((await b.service.listAssets(otherConversation, otherActor)).assets.map(asset => asset.ref)).toEqual(expect.arrayContaining([refB, generatedB.asset.ref]));
    expect((await b.service.prepareAsset(otherConversation, otherActor, refB, 'last-step', true)).contentBase64).toBe(inputB.toString('base64'));
  });

  it('omits deleted and unavailable artifacts from home recents even when canonical message references lack a tombstone', async () => {
    const t = await setup();
    const canonical = await t.service.registerAsset(output);
    await t.service.deleteAsset(conversationId, actor, canonical.asset.ref);
    await db.insert(schema.conversations).values({ id: conversationId, createdBy: actor, systemWorkspaceId: t.workspace.id, title: 'Recent artifact QA' });
    try {
      const components = [
        { id: 'deleted-marker', type: 'artifact' as const, data: { artifactId: 'legacy-deleted', filename: 'deleted-marker.docx', storagePath: 'private/deleted', assetDeletedAt: new Date().toISOString() } },
        { id: 'deleted-canonical', type: 'artifact' as const, data: { artifactId: canonical.documentId, filename: 'deleted-canonical.docx', storagePath: canonical.storagePath } },
        { id: 'deleted-path', type: 'artifact' as const, data: { artifactId: 'old-native-id', filename: 'deleted-path.docx', storagePath: canonical.storagePath } },
        { id: 'unavailable', type: 'artifact' as const, data: { artifactId: 'failed-output', filename: 'failed.docx', availability: 'failed' } },
        { id: 'live', type: 'artifact' as const, data: { artifactId: 'live-output', filename: 'retained.docx', storagePath: 'private/live', availability: 'ready' } },
      ];
      await db.insert(schema.messages).values({ id: newObjectId(), conversationId, conversationType: 'ai', isComplete: true, isStreaming: false, components });
      await db.insert(schema.messages).values({ id: newObjectId(), conversationId, conversationType: 'ai', isComplete: true, isStreaming: false, components: [components[1]] });
      const rows = await messages.listRecentArtifactMessages(actor, 12);
      expect(rows).toHaveLength(1);
      expect(rows[0].components).toEqual([components[4]]);
      const recent = await t.service.listRecent(actor, 6);
      expect(recent.map(file => file.filename)).toEqual(['retained.docx']);
      expect(JSON.stringify(recent)).not.toContain('deleted-');
      expect(JSON.stringify(recent)).not.toContain('private/live');
      expect(await messages.listRecentArtifactMessages(newObjectId(), 12)).toEqual([]);
    } finally { await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId)); }
  });
});
