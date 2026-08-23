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
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/report');

    await expect(service.resolveDownloadUrl('conversation-1', 'message-1', 'artifact-1')).resolves.toEqual({
      downloadUrl: 'https://storage.example/report',
    });
    expect(documentService.generateSasUrl).toHaveBeenCalledWith('owner/system_run/report.pdf', expect.objectContaining({ expiryMinutes: 10, checkExists: true }));
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
