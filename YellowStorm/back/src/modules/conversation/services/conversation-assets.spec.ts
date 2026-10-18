import { ServiceUnavailableException, ForbiddenException } from '@nestjs/common';
import { ConversationArtifactService } from './conversation-artifact.service';

describe('conversation assets', () => {
  const doc = { id: 'd', workspaceId: 'private', originalName: 'same.pdf', mimeType: 'application/pdf', size: 42, status: 'completed', path: 'secret/blob', isFolder: false };
  const conversations = { requireCurrentParticipant: jest.fn(), getUploadedDocuments: jest.fn(), getWorkspaceDocuments: jest.fn(), getConversationDocument: jest.fn(), filterAccessibleWorkspaceIds: jest.fn() };
  const messages = { listAssetMessages: jest.fn(), getMessageDocument: jest.fn() };
  const documents = { findById: jest.fn(), getDownloadUrl: jest.fn() };
  const settings = { isAttachmentIntelligenceEnabled: jest.fn(), getSettings: jest.fn() };
  const attachments = { readAuthorizedText: jest.fn() };
  const service = new ConversationArtifactService(messages as never, {} as never, conversations as never, documents as never,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, settings as never, attachments as never);
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

});
