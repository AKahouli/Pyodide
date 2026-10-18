import { ServiceUnavailableException, ForbiddenException } from '@nestjs/common';
import { ConversationArtifactService } from './conversation-artifact.service';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

describe('conversation assets', () => {
  const doc = { id: 'd', workspaceId: 'private', createdBy: 'a', originalName: 'same.pdf', mimeType: 'application/pdf', size: 42, status: 'completed', path: 'secret/blob', isFolder: false };
  const conversations = { requireCurrentParticipant: jest.fn(), getUploadedDocuments: jest.fn(), getWorkspaceDocuments: jest.fn(), getConversationDocument: jest.fn(), filterAccessibleWorkspaceIds: jest.fn() };
  const messages = { listAssetMessages: jest.fn(), getMessageDocument: jest.fn(), getAssetRevocationState: jest.fn(), listPendingAssetCleanup: jest.fn(), markAssetUnavailable: jest.fn(), markDocumentArtifactsUnavailable: jest.fn(), setAssetCleanup: jest.fn(), recordAssetStaging: jest.fn(), hasOtherLiveAssetPath: jest.fn() };
  const documents = { findById: jest.fn(), getDownloadUrl: jest.fn(), uploadSmallFile: jest.fn(), mergeMetadata: jest.fn(), deleteConversationAsset: jest.fn() };
  const settings = { isAttachmentIntelligenceEnabled: jest.fn(), getSettings: jest.fn() };
  const attachments = { readAuthorizedText: jest.fn() };
  const storage = { openReadStream: jest.fn(), upload: jest.fn(), delete: jest.fn(), exists: jest.fn() };
  const assetDocuments = { withWorkspaceTreeLock: jest.fn(), findFileByName: jest.fn(), findByIdsInWorkspace: jest.fn(), findByIdAndWorkspace: jest.fn(), mergeMetadata: jest.fn(), getAssetRevocationState: jest.fn(), listPendingAssetCleanup: jest.fn() };
  const service = new ConversationArtifactService(messages as never, storage as never, conversations as never, documents as never,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, settings as never, attachments as never, assetDocuments as never);
  beforeEach(() => {
    jest.resetAllMocks();
    conversations.getConversationDocument.mockResolvedValue({ createdBy: 'a', systemWorkspaceId: 'private', workspaces: ['shared'] });
    conversations.requireCurrentParticipant.mockImplementation(async (_c, actor) => {
      if (actor !== 'a') throw new ForbiddenException('current membership');
      return { createdBy: 'a', systemWorkspaceId: 'private', workspaces: ['shared'] };
    });
    conversations.getUploadedDocuments.mockImplementation(async (_c, _q, actor) => {
      if (actor !== 'a') throw new Error('current membership');
      return { documents: [doc], pagination: { totalPages: 1 } };
    });
    conversations.getWorkspaceDocuments.mockResolvedValue({ documents: [], pagination: { totalPages: 0 } });
    conversations.filterAccessibleWorkspaceIds.mockResolvedValue(['shared']);
    documents.findById.mockResolvedValue(doc);
    documents.getDownloadUrl.mockResolvedValue({ url: 'fresh-url' });
    settings.isAttachmentIntelligenceEnabled.mockResolvedValue(true);
    settings.getSettings.mockResolvedValue({ attachmentIntelligence: { maxIndexedTabularRows: 100 } });
    attachments.readAuthorizedText.mockResolvedValue({ content: 'PDF body', extraction: { truncated: false } });
    messages.listAssetMessages.mockResolvedValue({ records: [], hasMore: false, nextCursor: null });
    storage.openReadStream.mockImplementation(async () => ({ body: Readable.from([Buffer.from('selected bytes')]) }));
    assetDocuments.withWorkspaceTreeLock.mockImplementation(async (_workspace, action) => action());
    assetDocuments.findByIdsInWorkspace.mockResolvedValue([]);
    documents.uploadSmallFile.mockResolvedValue({ ...doc, id: 'registered', path: 'a/system-c/saved.docx' });
    messages.getAssetRevocationState.mockResolvedValue({ epoch: null, cleanupPending: false });
    messages.listPendingAssetCleanup.mockResolvedValue([]);
    messages.markAssetUnavailable.mockResolvedValue(true);
    messages.recordAssetStaging.mockResolvedValue(true);
    assetDocuments.getAssetRevocationState.mockResolvedValue({ epoch: null, cleanupPending: false });
    assetDocuments.listPendingAssetCleanup.mockResolvedValue([]);
  });
  it('persists canonical refs across reload without exposing storage paths and bounds PDF text', async () => {
    const first = await service.listAssets('c', 'a');
    expect(first.assets[0]).toMatchObject({ documentId: 'd', name: 'same.pdf', origin: 'upload' });
    expect(JSON.stringify(first)).not.toContain('secret/blob');
    expect((await service.listAssets('c', 'a')).assets[0].ref).toBe(first.assets[0].ref);
    expect(await service.assetUrl('c', 'a', first.assets[0].ref)).toEqual({ viewUrl: 'fresh-url', downloadUrl: 'fresh-url' });
    expect(await service.readAsset('c', 'a', first.assets[0].ref, 3)).toMatchObject({ contentType: 'text', text: 'PDF', truncated: true });
  });
  it('rejects second user listing, inspection, read and URL before byte access', async () => {
    const { assets } = await service.listAssets('c', 'a');
    for (const op of [() => service.listAssets('c', 'b'), () => service.inspectAsset('c', 'b', assets[0].ref),
      () => service.readAsset('c', 'b', assets[0].ref), () => service.assetUrl('c', 'b', assets[0].ref)]) await expect(op()).rejects.toThrow('current membership');
    expect(attachments.readAuthorizedText).not.toHaveBeenCalled();
    expect(documents.findById).not.toHaveBeenCalled();
  });
  it('rechecks workspace revocation and attachment policy at use time', async () => {
    const ref = Buffer.from(JSON.stringify(['document', 'revoked', 'd'])).toString('base64url');
    await expect(service.readAsset('c', 'a', ref)).rejects.toThrow('Asset not found');
    const own = (await service.listAssets('c', 'a')).assets[0].ref;
    settings.isAttachmentIntelligenceEnabled.mockResolvedValue(false);
    await expect(service.readAsset('c', 'a', own)).rejects.toThrow('attachments are disabled');
    expect((await service.listAssets('c', 'a')).assets).toEqual([]);
  });
  it('paginates through sources and unloaded messages with no draft bodies', async () => {
    const first = await service.listAssets('c', 'a');
    const second = await service.listAssets('c', 'a', { cursor: first.nextCursor! });
    messages.listAssetMessages.mockResolvedValueOnce({ records: [{ id: 'm', isComplete: true, components: [
      { id: 'ui', type: 'text', data: { content: 'root = Card("Saved")' } },
      { id: 'f', type: 'artifact', data: { artifactId: 'out', filename: 'report.docx', storagePath: 'secret/file' } },
    ] }], hasMore: true, nextCursor: 'older' });
    const third = await service.listAssets('c', 'a', { cursor: second.nextCursor! });
    expect(third.assets.map(a => a.kind)).toEqual(['app', 'file']);
    expect(JSON.stringify(third)).not.toContain('secret/file');
    await service.listAssets('c', 'a', { cursor: third.nextCursor! });
    expect(messages.listAssetMessages).toHaveBeenLastCalledWith('c', 'older', 50);
  });
  it('reads the saved program only and rejects a source from another conversation', async () => {
    const ref = Buffer.from(JSON.stringify(['app', 'message', 'ui'])).toString('base64url');
    messages.getMessageDocument.mockResolvedValue({ conversationId: 'c', isComplete: true, isStreaming: false,
      components: [{ id: 'ui', type: 'text', data: { content: 'root = Card("Saved")' } }], privateState: { secret: 'never return' } });
    expect(await service.readAsset('c', 'a', ref)).toMatchObject({ contentType: 'openui', program: 'root = Card("Saved")' });
    expect(JSON.stringify(await service.readAsset('c', 'a', ref))).not.toContain('never return');
    messages.getMessageDocument.mockResolvedValue({ conversationId: 'other', isComplete: true, components: [] });
    await expect(service.inspectAsset('c', 'a', ref)).rejects.toThrow('Asset not found');
  });
  it('keeps concurrent same-name uploads distinct by canonical identity', async () => {
    conversations.getUploadedDocuments.mockResolvedValue({ documents: [doc, { ...doc, id: 'd2' }], pagination: { totalPages: 1 } });
    const [one, two] = await Promise.all([service.listAssets('c', 'a'), service.listAssets('c', 'a')]);
    expect(new Set(one.assets.map(a => a.ref)).size).toBe(2);
    expect(two.assets.map(a => a.ref)).toEqual(one.assets.map(a => a.ref));
  });

  it('isolates source outages while never suppressing authorization failure', async () => {
    conversations.getUploadedDocuments.mockRejectedValueOnce(new ServiceUnavailableException('storage offline'));
    const failed = await service.listAssets('c', 'a');
    expect(failed.sourceErrors).toEqual(['upload']);
    expect(failed.nextCursor).toBeTruthy();
    conversations.getWorkspaceDocuments.mockResolvedValueOnce({ documents: [{ ...doc, workspaceId: 'shared' }], pagination: { totalPages: 1 } });
    const remaining = await service.listAssets('c', 'a', { cursor: failed.nextCursor! });
    expect(remaining.assets[0].origin).toBe('workspace');
    conversations.getUploadedDocuments.mockRejectedValueOnce(new ForbiddenException('denied'));
    await expect(service.listAssets('c', 'a')).rejects.toThrow('denied');
  });

  it('bounds a message with several assets and resumes every component exactly once', async () => {
    const cursor = Buffer.from(JSON.stringify({ group: 'message', page: 1 })).toString('base64url');
    messages.listAssetMessages.mockResolvedValue({ records: [{ id: 'm', isComplete: true, components: [1, 2, 3].map(n => ({
      id: `ui${n}`, type: 'text', data: { content: `root = Card("${n}")` },
    })) }], hasMore: false });
    let next: string | null = cursor;
    const refs: string[] = [];
    while (next) {
      const result = await service.listAssets('c', 'a', { cursor: next, limit: 1 });
      expect(result.assets).toHaveLength(1);
      refs.push(result.assets[0].ref);
      next = result.nextCursor;
    }
    expect(new Set(refs).size).toBe(3);
  });

  it('never follows raw storage metadata when evidence authority is also present', async () => {
    const ref = Buffer.from(JSON.stringify(['artifact', 'message', 'output'])).toString('base64url');
    messages.getMessageDocument.mockResolvedValue({ conversationId: 'c', isComplete: true, components: [
      { id: 'f', type: 'artifact', data: { artifactId: 'output', storagePath: 'private/wrong', evidenceId: 'e', executionId: 'x' } },
    ] });
    await expect(service.readAsset('c', 'a', ref)).rejects.toThrow('Artifact not found');
    expect(attachments.readAuthorizedText).not.toHaveBeenCalled();
  });

  it('prepares exact bytes under actor/run/invocation scope and binds deterministic receipts to the content version', async () => {
    const ref = (await service.listAssets('c', 'a')).assets[0].ref;
    const first = await service.prepareAsset('c', 'a', ref, 'turn-1');
    const retry = await service.prepareAsset('c', 'a', ref, 'turn-1');
    const nextTurn = await service.prepareAsset('c', 'a', ref, 'turn-2');
    expect(first.sha256).toBe(createHash('sha256').update('selected bytes').digest('hex'));
    expect(retry).toEqual(first);
    expect(nextTurn.sandboxPath).toBe(first.sandboxPath);
    expect(first.sandboxPath).toMatch(/^\/mnt\/workspace\/conversation-assets\/[a-f0-9]{64}\.pdf$/);
    expect(storage.upload).toHaveBeenCalledWith(Buffer.from('selected bytes'), 'same.pdf', 'application/pdf', {
      folder: `a/system_c/${first.sandboxPath.replace('/mnt/workspace/', '').split('/').slice(0, -1).join('/')}`,
      generateUniqueName: false, customFileName: first.sandboxPath.split('/').at(-1),
    });
    storage.openReadStream.mockResolvedValueOnce({ body: Readable.from([Buffer.from('new version')]) });
    expect((await service.prepareAsset('c', 'a', ref, 'turn-1')).sandboxPath).not.toBe(first.sandboxPath);
  });

  it('denies cross-user, malformed and revoked references before staging bytes', async () => {
    const ref = (await service.listAssets('c', 'a')).assets[0].ref;
    await expect(service.prepareAsset('c', 'b', ref, 'turn')).rejects.toThrow('current membership');
    await expect(service.prepareAsset('c', 'a', 'not-a-ref', 'turn')).rejects.toThrow('Asset not found');
    await expect(service.prepareAsset('c', 'a', ref, '../turn')).rejects.toThrow('Invalid asset invocation');
    const revoked = Buffer.from(JSON.stringify(['document', 'revoked', 'd'])).toString('base64url');
    await expect(service.prepareAsset('c', 'a', revoked, 'turn')).rejects.toThrow('Asset not found');
    expect(storage.openReadStream).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects pending files, apps, evidence paths and oversized actual bytes without publishing a receipt', async () => {
    const ref = (await service.listAssets('c', 'a')).assets[0].ref;
    documents.findById.mockResolvedValueOnce({ ...doc, status: 'processing' });
    await expect(service.prepareAsset('c', 'a', ref, 'turn')).rejects.toThrow('Only ready files');
    messages.getMessageDocument.mockResolvedValue({ conversationId: 'c', isComplete: true, components: [
      { id: 'ui', type: 'text', data: { content: 'root = Card("Saved")' } },
      { id: 'f', type: 'artifact', data: { artifactId: 'out', storagePath: 'wrong', evidenceId: 'e', executionId: 'x' } },
    ] });
    await expect(service.prepareAsset('c', 'a', Buffer.from(JSON.stringify(['app', 'm', 'ui'])).toString('base64url'), 'turn')).rejects.toThrow('Only ready files');
    await expect(service.prepareAsset('c', 'a', Buffer.from(JSON.stringify(['artifact', 'm', 'out'])).toString('base64url'), 'turn')).rejects.toThrow('Artifact not found');
    storage.openReadStream.mockResolvedValueOnce({ body: Readable.from([Buffer.alloc(50 * 1024 * 1024 + 1)]) });
    await expect(service.prepareAsset('c', 'a', ref, 'turn')).rejects.toThrow('size limit');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('propagates storage limit failures and never returns a prepared receipt', async () => {
    const ref = (await service.listAssets('c', 'a')).assets[0].ref;
    storage.upload.mockRejectedValueOnce(new ForbiddenException('upload limit'));
    await expect(service.prepareAsset('c', 'a', ref, 'turn')).rejects.toThrow('upload limit');
  });

  it('returns bounded bytes only to explicit internal transfer requests with the same version receipt', async () => {
    const ref = (await service.listAssets('c', 'a')).assets[0].ref;
    const ordinary = await service.prepareAsset('c', 'a', ref, 'turn');
    const transfer = await service.prepareAsset('c', 'a', ref, 'turn', true);
    expect(ordinary).not.toHaveProperty('contentBase64');
    expect(transfer).toEqual({ ...ordinary, contentBase64: Buffer.from('selected bytes').toString('base64') });
    await expect(service.prepareAsset('c', 'b', ref, 'turn', true)).rejects.toThrow('current membership');
    storage.upload.mockClear();
    storage.openReadStream.mockResolvedValueOnce({ body: Readable.from([Buffer.alloc(10 * 1024 * 1024 + 1)]) });
    await expect(service.prepareAsset('c', 'a', ref, 'turn', true)).rejects.toThrow('direct transfer size limit');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  const output = { userId: 'a', conversationId: 'c', invocationId: 'turn-1', sourcePath: 'a/system_c/outputs/report.docx', fileName: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  it('registers exact output bytes through the existing quota owner and restores its canonical receipt on retry', async () => {
    const first = await service.registerAsset(output);
    expect(first).toMatchObject({ documentId: 'registered', artifactId: 'registered', storagePath: 'a/system-c/saved.docx', invocationId: 'turn-1' });
    expect(first.asset).toMatchObject({ origin: 'generated', name: 'report.docx' });
    expect(documents.uploadSmallFile).toHaveBeenCalledWith('private', 'a', Buffer.from('selected bytes'), expect.stringMatching(/^generated-[a-f0-9]{64}\.docx$/), output.mimeType, undefined, false, false);
    const receipt = documents.mergeMetadata.mock.calls[0][2];
    assetDocuments.findFileByName.mockResolvedValue({ ...doc, id: 'registered', metadata: receipt });
    documents.findById.mockResolvedValue({ ...doc, id: 'registered', path: first.storagePath, metadata: receipt });
    const retry = await service.registerAsset(output);
    expect(retry.asset.ref).toBe(first.asset.ref);
    expect(documents.uploadSmallFile).toHaveBeenCalledTimes(1);
    expect(assetDocuments.withWorkspaceTreeLock).toHaveBeenCalledTimes(2);
  });

  it('denies another actor, traversal and input receipts before reading output storage', async () => {
    await expect(service.registerAsset({ ...output, userId: 'b' })).rejects.toThrow('current membership');
    for (const sourcePath of ['b/system_c/out.docx', 'a/system_other/out.docx', 'a/system_c/../out.docx', 'a/system_c/conversation-assets/input.docx']) {
      await expect(service.registerAsset({ ...output, sourcePath })).rejects.toThrow('outside the current run');
    }
    expect(storage.openReadStream).not.toHaveBeenCalled();
    expect(documents.uploadSmallFile).not.toHaveBeenCalled();
  });

  it('publishes no ready receipt when workspace quota or storage fails', async () => {
    documents.uploadSmallFile.mockRejectedValueOnce(new ForbiddenException('quota exceeded'));
    await expect(service.registerAsset(output)).rejects.toThrow('quota exceeded');
    expect(documents.mergeMetadata).not.toHaveBeenCalled();
    storage.openReadStream.mockRejectedValueOnce(new Error('blob unavailable'));
    await expect(service.registerAsset(output)).rejects.toThrow('blob unavailable');
    expect(documents.uploadSmallFile).toHaveBeenCalledTimes(1);
  });

  it('cleans only the newly allocated blob on metadata failure and rejects publication', async () => {
    documents.mergeMetadata.mockRejectedValueOnce(new Error('metadata unavailable'));
    await expect(service.registerAsset(output)).rejects.toThrow('metadata unavailable');
    expect(storage.delete).toHaveBeenCalledWith('a/system-c/saved.docx');
    expect(storage.delete).not.toHaveBeenCalledWith(output.sourcePath);
  });

  it('lists a registered output only as its canonical document, not again as a message artifact', async () => {
    const id = 'a'.repeat(24);
    assetDocuments.findByIdsInWorkspace.mockResolvedValue([{ id, metadata: { assetOrigin: 'generated' } }]);
    messages.listAssetMessages.mockResolvedValue({ records: [{ id: 'm', isComplete: true, components: [
      { id: 'f', type: 'artifact', data: { artifactId: id, storagePath: 'a/system_c/file' } },
    ] }], hasMore: false });
    const cursor = Buffer.from(JSON.stringify({ group: 'message', page: 1 })).toString('base64url');
    expect((await service.listAssets('c', 'a', { cursor })).assets).toEqual([]);
  });

  it('authorizes owned file deletion and preserves retries while denying linked workspaces and the other actor', async () => {
    const ref = (await service.listAssets('c', 'a')).assets[0].ref;
    documents.deleteConversationAsset.mockResolvedValue({ deleted: true, alreadyDeleted: false, cleanup: { blob: 'pending', index: 'done' } });
    expect(await service.deleteAsset('c', 'a', ref)).toMatchObject({ deleted: true, cleanup: { blob: 'pending' } });
    expect(documents.deleteConversationAsset).toHaveBeenCalledWith('private', 'd', 'c');
    expect(messages.markDocumentArtifactsUnavailable).toHaveBeenCalledWith('c', 'd');
    await expect(service.deleteAsset('c', 'b', ref)).rejects.toThrow('current membership');
    documents.findById.mockResolvedValueOnce({ ...doc, workspaceId: 'shared' });
    const shared = Buffer.from(JSON.stringify(['document', 'shared', 'd'])).toString('base64url');
    await expect(service.deleteAsset('c', 'a', shared)).rejects.toThrow('Asset not found');
    expect(documents.deleteConversationAsset).toHaveBeenCalledTimes(1);
  });

  it('hides tombstones from active lists and denies inspect/read/stage/url while retaining owner cleanup recovery', async () => {
    const ref = (await service.listAssets('c', 'a')).assets[0].ref;
    const deleted = { ...doc, status: 'failed', metadata: { assetDeletedAt: 'now', assetBlobCleanup: 'pending', assetIndexCleanup: 'done' } };
    documents.findById.mockResolvedValue(deleted);
    conversations.getUploadedDocuments.mockResolvedValue({ documents: [deleted], pagination: { totalPages: 1 } });
    assetDocuments.listPendingAssetCleanup.mockResolvedValue([deleted]);
    const list = await service.listAssets('c', 'a');
    expect(list.assets).toEqual([]);
    expect(list.pendingCleanup?.[0]).toMatchObject({ ref, status: 'deleted', actions: { view: false, read: false, download: false, delete: true } });
    expect(JSON.stringify(list)).not.toContain('secret/blob');
    for (const operation of [() => service.inspectAsset('c', 'a', ref), () => service.readAsset('c', 'a', ref),
      () => service.prepareAsset('c', 'a', ref, 'turn'), () => service.assetUrl('c', 'a', ref)]) await expect(operation()).rejects.toThrow('Asset not found');
    expect(storage.openReadStream).not.toHaveBeenCalled();
  });

  it('deletes a logical app with source-match CAS and rejects changed source without touching private drafts', async () => {
    const component = { id: 'ui', type: 'text', data: { content: 'root = Card("Saved")' } };
    messages.getMessageDocument.mockResolvedValue({ conversationId: 'c', isComplete: true, components: [component] });
    const ref = Buffer.from(JSON.stringify(['app', 'm', 'ui'])).toString('base64url');
    expect(await service.deleteAsset('c', 'a', ref)).toMatchObject({ deleted: true, alreadyDeleted: false, cleanup: { blob: 'notApplicable' } });
    expect(messages.markAssetUnavailable).toHaveBeenCalledWith('c', 'm', component);
    messages.markAssetUnavailable.mockResolvedValueOnce(false);
    await expect(service.deleteAsset('c', 'a', ref)).rejects.toThrow('source changed');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('fences publication on current revocation epoch and exact selected bytes', async () => {
    const ref = (await service.listAssets('c', 'a')).assets[0].ref;
    await expect(service.registerAsset({ ...output, inputReceipts: [{ ref, sha256: '0'.repeat(64) }] })).rejects.toThrow('version changed');
    expect(documents.uploadSmallFile).not.toHaveBeenCalled();
    assetDocuments.getAssetRevocationState.mockResolvedValue({ epoch: '1:fixed-time', cleanupPending: false });
    const first = await service.assetRevocationState('c', 'a');
    await expect(service.registerAsset(output)).rejects.toThrow('Sandbox asset access changed');
    expect((await service.registerAsset({ ...output, sandboxEpoch: first.epoch })).documentId).toBe('registered');
    assetDocuments.getAssetRevocationState.mockResolvedValue({ epoch: '2:fixed-time', cleanupPending: false });
    expect((await service.assetRevocationState('c', 'a')).epoch).not.toBe(first.epoch);
    await expect(service.registerAsset({ ...output, sandboxEpoch: first.epoch })).rejects.toThrow('Sandbox asset access changed');
    assetDocuments.getAssetRevocationState.mockResolvedValue({ epoch: '2:fixed-time', cleanupPending: true });
    const pending = await service.assetRevocationState('c', 'a');
    await expect(service.registerAsset({ ...output, sandboxEpoch: pending.epoch })).rejects.toThrow('Sandbox asset access changed');
  });

  it('preserves a legacy raw alias still owned by another live artifact component', async () => {
    const component = { id: 'legacy', type: 'artifact', data: { artifactId: 'out', storagePath: 'a/system_c/report.docx', filename: 'report.docx' } };
    messages.getMessageDocument.mockResolvedValue({ conversationId: 'c', isComplete: true, components: [component] });
    messages.hasOtherLiveAssetPath.mockResolvedValue(true);
    const ref = Buffer.from(JSON.stringify(['artifact', 'm', 'out'])).toString('base64url');
    expect((await service.deleteAsset('c', 'a', ref)).cleanup.blob).toBe('done');
    expect(messages.hasOtherLiveAssetPath).toHaveBeenCalledWith('c', 'm', 'legacy', component.data.storagePath);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(messages.setAssetCleanup).toHaveBeenCalledWith('c', 'm', 'legacy', 'done');
  });

  it('allows a current uploader or conversation creator, but rejects another participant and a foreign message reference', async () => {
    conversations.requireCurrentParticipant.mockResolvedValue({ createdBy: 'owner', systemWorkspaceId: 'private', workspaces: ['shared'] });
    documents.findById.mockResolvedValue({ ...doc, createdBy: 'uploader' });
    documents.deleteConversationAsset.mockResolvedValue({ deleted: true, alreadyDeleted: false, cleanup: { blob: 'done', index: 'done' } });
    const ref = Buffer.from(JSON.stringify(['document', 'private', 'd'])).toString('base64url');
    await expect(service.deleteAsset('c', 'participant', ref)).rejects.toThrow('Asset not found');
    expect((await service.deleteAsset('c', 'uploader', ref)).deleted).toBe(true);
    expect((await service.deleteAsset('c', 'owner', ref)).deleted).toBe(true);
    expect(documents.deleteConversationAsset).toHaveBeenCalledTimes(2);
    messages.getMessageDocument.mockResolvedValue({ conversationId: 'other-conversation', isComplete: true, components: [
      { id: 'app', type: 'text', data: { content: 'root = Card("foreign")' } },
    ] });
    const app = Buffer.from(JSON.stringify(['app', 'foreign-message', 'app'])).toString('base64url');
    await expect(service.deleteAsset('c', 'owner', app)).rejects.toThrow('Asset not found');
    expect(messages.markAssetUnavailable).not.toHaveBeenCalled();
  });

});
