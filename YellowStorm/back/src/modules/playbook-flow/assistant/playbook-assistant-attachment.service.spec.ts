import { PlaybookAssistantAttachmentService } from './playbook-assistant-attachment.service';

const query = <T>(value: T) => ({
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

describe('PlaybookAssistantAttachmentService', () => {
  const createService = () => {
    const model = {
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
      create: jest.fn().mockResolvedValue(undefined),
      deleteOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
      findOne: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
      find: jest.fn(),
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    };
    const documentService = {
      generateSasUrl: jest.fn().mockResolvedValue('https://storage.example/upload'),
      getMetadata: jest.fn(),
      download: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new PlaybookAssistantAttachmentService(model as never, documentService as never),
      model,
      documentService,
    };
  };

  it('removes pending metadata when upload URL creation fails', async () => {
    const { service, model, documentService } = createService();
    documentService.generateSasUrl.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(service.initialize({
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      requestId: 'request-1',
      expectedDefinitionRevision: 7,
      mediaType: 'image/png',
      size: 8,
    })).rejects.toThrow('storage unavailable');
    const attachmentId = model.create.mock.calls[0][0].attachmentId;
    expect(model.deleteOne).toHaveBeenCalledWith({ attachmentId });
  });

  it('confirms an owned upload only after exact size and signature verification', async () => {
    const { service, model, documentService } = createService();
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    model.findOne.mockReturnValue(query({
      attachmentId: 'attachment-1',
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      objectKey: 'object-1',
      mediaType: 'image/png',
      declaredSize: bytes.length,
      expiresAt: new Date(Date.now() + 60_000),
    }));
    documentService.getMetadata.mockResolvedValue({ size: bytes.length });
    documentService.download.mockResolvedValue(bytes);

    await expect(service.confirm('user-1', 'playbook-1', 'attachment-1')).resolves.toEqual({
      attachmentId: 'attachment-1',
      status: 'confirmed',
    });
    expect(model.updateOne).toHaveBeenCalledWith(
      { attachmentId: 'attachment-1', ownerId: 'user-1', playbookId: 'playbook-1' },
      { $set: {
        status: 'confirmed',
        actualSize: bytes.length,
        contentSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
      } },
    );
  });

  it('deletes invalid uploaded content and never confirms it', async () => {
    const { service, model, documentService } = createService();
    model.findOne.mockReturnValue(query({
      attachmentId: 'attachment-1',
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      objectKey: 'object-1',
      mediaType: 'image/png',
      declaredSize: 8,
      expiresAt: new Date(Date.now() + 60_000),
    }));
    documentService.getMetadata.mockResolvedValue({ size: 8 });
    documentService.download.mockResolvedValue(Buffer.alloc(8));

    await expect(service.confirm('user-1', 'playbook-1', 'attachment-1')).rejects.toThrow(
      'Uploaded assistant image content is invalid',
    );
    expect(documentService.delete).toHaveBeenCalledWith('object-1');
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('binds confirmed attachments to the exact owner, request, Playbook, and revision', async () => {
    const { service, model } = createService();
    model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(2) });

    await service.assertBindings({
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      requestId: 'request-1',
      expectedDefinitionRevision: 7,
      attachmentIds: ['attachment-1', 'attachment-2'],
    });

    expect(model.countDocuments).toHaveBeenCalledWith(expect.objectContaining({
      attachmentId: { $in: ['attachment-1', 'attachment-2'] },
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      requestId: 'request-1',
      expectedDefinitionRevision: 7,
      status: 'confirmed',
    }));
  });

  it('rejects bytes replaced after confirmation through a still-valid upload URL', async () => {
    const { service, model, documentService } = createService();
    const original = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const replaced = Buffer.from([137, 80, 78, 71, 13, 10, 26, 11]);
    model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });
    model.find.mockReturnValue(query([{
      attachmentId: 'attachment-1',
      objectKey: 'object-1',
      mediaType: 'image/png',
      actualSize: original.length,
      contentSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
    }]));
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
});
