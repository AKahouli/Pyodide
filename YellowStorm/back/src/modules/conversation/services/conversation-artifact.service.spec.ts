import { ConversationArtifactService } from './conversation-artifact.service';

describe('ConversationArtifactService', () => {
  const messageService = { getMessageDocument: jest.fn() };
  const documentService = { isAvailable: jest.fn(() => true), generateSasUrl: jest.fn() };
  const service = new ConversationArtifactService(messageService as never, documentService as never);

  beforeEach(() => jest.clearAllMocks());

  it('resolves a persisted artifact by scoped opaque identity', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{ type: 'artifact', data: { artifactId: 'artifact-1', filename: 'report.pdf', storagePath: 'owner/system_run/report.pdf' } }],
    });
    documentService.generateSasUrl
      .mockResolvedValueOnce('https://storage.example/view-report')
      .mockResolvedValueOnce('https://storage.example/download-report');

    await expect(service.resolveDownloadUrl('conversation-1', 'message-1', 'artifact-1')).resolves.toEqual({
      viewUrl: 'https://storage.example/view-report',
      downloadUrl: 'https://storage.example/download-report',
    });
    expect(documentService.generateSasUrl).toHaveBeenNthCalledWith(1, 'owner/system_run/report.pdf', {
      expiryMinutes: 10,
      checkExists: true,
    });
    expect(documentService.generateSasUrl).toHaveBeenNthCalledWith(2, 'owner/system_run/report.pdf', expect.objectContaining({
      expiryMinutes: 10,
      checkExists: true,
      contentDisposition: 'attachment; filename="report.pdf"',
    }));
  });

  it('does not resolve artifacts from another conversation', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-2' },
      components: [],
    });

    await expect(service.resolveDownloadUrl('conversation-1', 'message-1', 'artifact-1')).rejects.toMatchObject({ status: 404 });
    expect(documentService.generateSasUrl).not.toHaveBeenCalled();
  });
});
