import { ConversationArtifactService } from './conversation-artifact.service';

describe('ConversationArtifactService', () => {
  const messageService = { getMessageDocument: jest.fn() };
  const documentService = { isAvailable: jest.fn(() => true), generateSasUrl: jest.fn() };
  const conversationService = { getConversationDocument: jest.fn() };
  const workspaceDocumentService = { findByMultipleWorkspaces: jest.fn() };
  const service = new ConversationArtifactService(
    messageService as never,
    documentService as never,
    conversationService as never,
    workspaceDocumentService as never,
  );

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

  it('resolves a persisted citation alias through conversation workspaces', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{ type: 'citation', data: { source: 'deepsearch', fileName: 'report.pdf', sourceType: 'text' } }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{ originalName: 'report.pdf', filename: 'stored-report.pdf', mimeType: 'application/pdf', path: 'owner/workspace/report.pdf', isFolder: false }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/report');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'deepsearch', fileName: 'report.pdf',
    })).resolves.toEqual({ url: 'https://storage.example/report', fileName: 'report.pdf', mimeType: 'application/pdf' });
    expect(documentService.generateSasUrl).toHaveBeenCalledWith('owner/workspace/report.pdf', {
      expiryMinutes: 10,
      checkExists: true,
    });
  });

  it('resolves a redacted selector by its persisted filename and reference', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{
        type: 'citation',
        data: { source: 'deepsearch', fileName: 'report.pdf', reference: '[7]', workspaceId: 'workspace-1' },
      }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }, { toString: () => 'workspace-2' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{ originalName: 'report.pdf', mimeType: 'application/pdf', path: 'owner/one/report.pdf', isFolder: false }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/report');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: '[REDACTED]', fileName: 'report.pdf', reference: '7',
    })).resolves.toMatchObject({ fileName: 'report.pdf' });
    expect(workspaceDocumentService.findByMultipleWorkspaces).toHaveBeenCalledWith(
      ['workspace-1'],
      { search: 'report.pdf', page: 1, limit: 100, searchFilename: true },
    );
  });

  it('matches citations that name the storage filename when the original name differs', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{
        type: 'citation',
        data: {
          source: 'owner/bpce-summit/FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
          fileName: 'FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
        },
      }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{
        originalName: 'FP PRET EMPRUNT TEC10_CHROME_v1.pdf',
        filename: 'FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
        mimeType: 'application/pdf',
        path: 'owner/ws/FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
        isFolder: false,
      }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/doc');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'owner/bpce-summit/FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
      fileName: 'FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf',
    })).resolves.toMatchObject({ fileName: 'FP PRET EMPRUNT TEC10_CHROME_v1.pdf' });
    expect(workspaceDocumentService.findByMultipleWorkspaces).toHaveBeenCalledWith(
      ['workspace-1'],
      { search: 'FP_PRET_EMPRUNT_TEC10_CHROME_v1.pdf', page: 1, limit: 100, searchFilename: true },
    );
  });

  it('resolves a legacy source-only citation', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{ type: 'citation', data: { source: 'owner/workspace/legacy.pdf' } }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{ originalName: 'legacy.pdf', mimeType: 'application/pdf', path: 'owner/workspace/legacy.pdf', isFolder: false }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/legacy');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'owner/workspace/legacy.pdf',
    })).resolves.toMatchObject({ fileName: 'legacy.pdf' });
  });

  it('resolves a filename-less flat image citation by its path', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{
        type: 'citation',
        data: { sourceType: 'image', path: 'owner/workspace/chart.png', workspaceId: 'workspace-1' },
      }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{ originalName: 'chart.png', mimeType: 'image/png', path: 'owner/workspace/chart.png', isFolder: false }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/chart');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'owner/workspace/chart.png',
    })).resolves.toEqual({
      url: 'https://storage.example/chart', fileName: 'chart.png', mimeType: 'image/png',
    });
  });

  it('accepts repeated components with the same persisted citation identity', async () => {
    const citation = {
      type: 'citation',
      data: { source: 'deepsearch', fileName: 'report.pdf', reference: '[7]', workspaceId: 'workspace-1' },
    };
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [citation, citation],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [{ originalName: 'report.pdf', mimeType: 'application/pdf', path: 'owner/one/report.pdf', isFolder: false }],
      pagination: { total: 1 },
    });
    documentService.generateSasUrl.mockResolvedValue('https://storage.example/report');

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: '[REDACTED]', fileName: 'report.pdf', reference: '7',
    })).resolves.toMatchObject({ fileName: 'report.pdf' });
  });

  it('does not resolve a selector absent from the scoped message', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{ type: 'citation', data: { source: 'deepsearch', fileName: 'report.pdf' } }],
    });

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'another-source', fileName: 'another-report.pdf',
    })).rejects.toMatchObject({ status: 404 });
    expect(workspaceDocumentService.findByMultipleWorkspaces).not.toHaveBeenCalled();
  });

  it('rejects ambiguous exact filename matches across allowed workspaces', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{ type: 'citation', data: { source: 'deepsearch', fileName: 'report.pdf' } }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }, { toString: () => 'workspace-2' }],
    });
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({
      documents: [
        { originalName: 'report.pdf', path: 'owner/one/report.pdf', isFolder: false },
        { originalName: 'report.pdf', path: 'owner/two/report.pdf', isFolder: false },
      ],
      pagination: { total: 2 },
    });

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: 'deepsearch', fileName: 'report.pdf',
    })).rejects.toMatchObject({ status: 404 });
    expect(documentService.generateSasUrl).not.toHaveBeenCalled();
  });

  it('rejects duplicate persisted filenames with different workspace identities', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [
        { type: 'citation', data: { source: 'one/report.pdf', fileName: 'report.pdf', workspaceId: 'workspace-1' } },
        { type: 'citation', data: { source: 'two/report.pdf', fileName: 'report.pdf', workspaceId: 'workspace-2' } },
      ],
    });

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: '[REDACTED]', fileName: 'report.pdf',
    })).rejects.toMatchObject({ status: 404 });
    expect(conversationService.getConversationDocument).not.toHaveBeenCalled();
    expect(documentService.generateSasUrl).not.toHaveBeenCalled();
  });

  it('rejects a persisted citation workspace outside the conversation scope', async () => {
    messageService.getMessageDocument.mockResolvedValue({
      conversationId: { toString: () => 'conversation-1' },
      components: [{
        type: 'citation',
        data: { source: 'deepsearch', fileName: 'report.pdf', workspaceId: 'workspace-2' },
      }],
    });
    conversationService.getConversationDocument.mockResolvedValue({
      workspaces: [{ toString: () => 'workspace-1' }],
    });

    await expect(service.resolveCitationUrl('conversation-1', 'message-1', {
      source: '[REDACTED]', fileName: 'report.pdf',
    })).rejects.toMatchObject({ status: 404 });
    expect(workspaceDocumentService.findByMultipleWorkspaces).not.toHaveBeenCalled();
  });
});
