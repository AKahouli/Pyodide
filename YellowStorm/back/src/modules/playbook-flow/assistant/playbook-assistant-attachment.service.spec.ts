import { PlaybookAssistantAttachmentService } from './playbook-assistant-attachment.service';

const PNG_SHA256 = '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6';

describe('PlaybookAssistantAttachmentService', () => {
  const createService = () => {
    const attachments = {
      countLiveForRequest: jest.fn().mockResolvedValue(0),
      insert: jest.fn().mockResolvedValue(undefined),
      deleteByAttachmentId: jest.fn().mockResolvedValue(undefined),
      findOwned: jest.fn().mockResolvedValue(null),
      confirm: jest.fn().mockResolvedValue(undefined),
      countConfirmedBindings: jest.fn().mockResolvedValue(0),
      findByAttachmentIds: jest.fn().mockResolvedValue([]),
      listExpired: jest.fn().mockResolvedValue([]),
      deleteByAttachmentIds: jest.fn().mockResolvedValue(undefined),
    };
    const documentService = {
      generateSasUrl: jest.fn().mockResolvedValue('https://storage.example/upload'),
      getMetadata: jest.fn(),
      download: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new PlaybookAssistantAttachmentService(attachments as never, documentService as never),
      attachments,
      documentService,
    };
  };
  const initialize = {
    ownerId: 'user-1',
    playbookId: 'playbook-1',
    requestId: 'request-1',
    expectedDefinitionRevision: 7,
    mediaType: 'image/png',
    size: 8,
  };

  it('registers a pending attachment and hands out a short-lived upload URL', async () => {
    const { service, attachments, documentService } = createService();

    const result = await service.initialize(initialize);

    const inserted = attachments.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      requestId: 'request-1', ownerId: 'user-1', playbookId: 'playbook-1', expectedDefinitionRevision: 7,
      mediaType: 'image/png', declaredSize: 8, objectKey: `playbook-assistant/user-1/${inserted.attachmentId}.png`,
    });
    expect(attachments.countLiveForRequest).toHaveBeenCalledWith('user-1', 'request-1');
    expect(documentService.generateSasUrl).toHaveBeenCalledWith(inserted.objectKey, { permissions: 'cw', expiryMinutes: 10 });
    expect(result).toEqual({ attachmentId: inserted.attachmentId, uploadUrl: 'https://storage.example/upload', expiresAt: inserted.expiresAt.toISOString() });
  });

  it('refuses a fifth image for the same request', async () => {
    const { service, attachments } = createService();
    attachments.countLiveForRequest.mockResolvedValue(4);

    await expect(service.initialize(initialize)).rejects.toThrow('Cannot attach more than four images');
    expect(attachments.insert).not.toHaveBeenCalled();
  });

  it('removes pending metadata when upload URL creation fails', async () => {
    const { service, attachments, documentService } = createService();
    documentService.generateSasUrl.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(service.initialize(initialize)).rejects.toThrow('storage unavailable');
    const attachmentId = attachments.insert.mock.calls[0][0].attachmentId;
    expect(attachments.deleteByAttachmentId).toHaveBeenCalledWith(attachmentId);
  });

  it('confirms an owned upload only after exact size and signature verification', async () => {
    const { service, attachments, documentService } = createService();
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    attachments.findOwned.mockResolvedValue({
      attachmentId: 'attachment-1',
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      objectKey: 'object-1',
      mediaType: 'image/png',
      declaredSize: bytes.length,
      expiresAt: new Date(Date.now() + 60_000),
    });
    documentService.getMetadata.mockResolvedValue({ size: bytes.length });
    documentService.download.mockResolvedValue(bytes);

    await expect(service.confirm('user-1', 'playbook-1', 'attachment-1')).resolves.toEqual({
      attachmentId: 'attachment-1',
      status: 'confirmed',
    });
    expect(attachments.findOwned).toHaveBeenCalledWith('attachment-1', 'user-1', 'playbook-1');
    expect(attachments.confirm).toHaveBeenCalledWith('attachment-1', 'user-1', 'playbook-1', {
      actualSize: bytes.length,
      contentSha256: PNG_SHA256,
    });
  });

  it('treats an expired attachment as gone', async () => {
    const { service, attachments } = createService();
    attachments.findOwned.mockResolvedValue({ attachmentId: 'attachment-1', objectKey: 'object-1', expiresAt: new Date(Date.now() - 1) });

    await expect(service.confirm('user-1', 'playbook-1', 'attachment-1')).rejects.toThrow('not found or expired');
    expect(attachments.confirm).not.toHaveBeenCalled();
  });

  it('deletes invalid uploaded content and never confirms it', async () => {
    const { service, attachments, documentService } = createService();
    attachments.findOwned.mockResolvedValue({
      attachmentId: 'attachment-1',
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      objectKey: 'object-1',
      mediaType: 'image/png',
      declaredSize: 8,
      expiresAt: new Date(Date.now() + 60_000),
    });
    documentService.getMetadata.mockResolvedValue({ size: 8 });
    documentService.download.mockResolvedValue(Buffer.alloc(8));

    await expect(service.confirm('user-1', 'playbook-1', 'attachment-1')).rejects.toThrow(
      'Uploaded assistant image content is invalid',
    );
    expect(documentService.delete).toHaveBeenCalledWith('object-1');
    expect(attachments.confirm).not.toHaveBeenCalled();
  });

  it('binds confirmed attachments to the exact owner, request, Playbook, and revision', async () => {
    const { service, attachments } = createService();
    attachments.countConfirmedBindings.mockResolvedValue(2);

    await service.assertBindings({
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      requestId: 'request-1',
      expectedDefinitionRevision: 7,
      attachmentIds: ['attachment-1', 'attachment-2'],
    });

    expect(attachments.countConfirmedBindings).toHaveBeenCalledWith({
      attachmentIds: ['attachment-1', 'attachment-2'],
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      requestId: 'request-1',
      expectedDefinitionRevision: 7,
    });

    attachments.countConfirmedBindings.mockResolvedValue(1);
    await expect(service.assertBindings({
      ownerId: 'user-1', playbookId: 'playbook-1', requestId: 'request-1', expectedDefinitionRevision: 7,
      attachmentIds: ['attachment-1', 'attachment-2'],
    })).rejects.toThrow('binding is invalid or expired');
  });

  it('rejects bytes replaced after confirmation through a still-valid upload URL', async () => {
    const { service, attachments, documentService } = createService();
    const original = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const replaced = Buffer.from([137, 80, 78, 71, 13, 10, 26, 11]);
    attachments.countConfirmedBindings.mockResolvedValue(1);
    attachments.findByAttachmentIds.mockResolvedValue([{
      attachmentId: 'attachment-1',
      objectKey: 'object-1',
      mediaType: 'image/png',
      actualSize: original.length,
      contentSha256: PNG_SHA256,
    }]);
    documentService.download.mockResolvedValue(replaced);

    await expect(service.resolveImages({
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      requestId: 'request-1',
      expectedDefinitionRevision: 7,
      attachmentIds: ['attachment-1'],
    })).rejects.toThrow('changed after verification');
    expect(documentService.delete).toHaveBeenCalledWith('object-1');
  });

  it('removes an expired row only after its stored object is deleted', async () => {
    const { service, attachments, documentService } = createService();
    attachments.listExpired.mockResolvedValue([
      { attachmentId: 'attachment-1', objectKey: 'object-1' },
      { attachmentId: 'attachment-2', objectKey: 'object-2' },
    ]);
    documentService.delete.mockImplementation(async (objectKey: string) => {
      if (objectKey === 'object-2') throw new Error('storage unavailable');
    });

    await (service as unknown as { cleanupExpired: () => Promise<void> }).cleanupExpired();

    expect(attachments.listExpired).toHaveBeenCalledWith(100);
    expect(attachments.deleteByAttachmentIds).toHaveBeenCalledWith(['attachment-1']);
  });
});
