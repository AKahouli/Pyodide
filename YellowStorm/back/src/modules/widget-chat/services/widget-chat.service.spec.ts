import { ConfigService } from '@nestjs/config';
import { WidgetChatService } from './widget-chat.service';
import { NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { DocumentStatus, IndexingStatus } from '@modules/workspace/schemas/workspace-document.schema';

const WS_ID = '507f1f77bcf86cd799439011';
const DOC_ID = '507f1f77bcf86cd799439012';
const OWNER_ID = '507f191e810c19729de860ea';
const OBJECT_KEY = `${OWNER_ID}/prefix/report.pdf`;

function createCitationService() {
  const documentService = {
    isAvailable: jest.fn().mockReturnValue(true),
    exists: jest.fn().mockResolvedValue(true),
    list: jest.fn().mockResolvedValue({ documents: [] }),
  };
  const workspaceDocumentService = {
    generateReadUrl: jest.fn().mockResolvedValue('https://ceph.example/signed-url'),
    findByMultipleWorkspaces: jest.fn().mockResolvedValue({ documents: [] }),
  };
  const workspaceService = {
    getStorageContext: jest.fn().mockResolvedValue({
      ownerUserId: OWNER_ID,
      storagePrefix: 'prefix',
    }),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };

  const service = new WidgetChatService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    documentService as any,
    workspaceDocumentService as any,
    workspaceService as any,
    { get: jest.fn() } as unknown as ConfigService,
    logger as any,
  );

  return { service, documentService, workspaceDocumentService, workspaceService, logger };
}

function buildDocResponse(path: string) {
  return {
    id: DOC_ID,
    originalName: 'report.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    path,
    workspaceId: WS_ID,
    createdBy: OWNER_ID,
    status: DocumentStatus.COMPLETED,
    indexingStatus: IndexingStatus.NONE,
  };
}

describe('WidgetChatService.generateCitationUrl', () => {
  it('signs via generateReadUrl when path is allowed and blob exists', async () => {
    const { service, documentService, workspaceDocumentService, workspaceService } =
      createCitationService();

    const result = await service.generateCitationUrl({
      source: OBJECT_KEY,
      fileName: 'report.pdf',
      agentKnowledgeBaseIds: [WS_ID],
    });

    expect(workspaceService.getStorageContext).toHaveBeenCalledWith(WS_ID);
    expect(documentService.exists).toHaveBeenCalledWith(OBJECT_KEY);
    expect(workspaceDocumentService.generateReadUrl).toHaveBeenCalledWith(OBJECT_KEY);
    expect(workspaceDocumentService.findByMultipleWorkspaces).not.toHaveBeenCalled();
    expect(result).toEqual({ downloadUrl: 'https://ceph.example/signed-url' });
  });

  it('falls back to findByMultipleWorkspaces for legacy filename-only citations', async () => {
    const { service, documentService, workspaceDocumentService } = createCitationService();
    const doc = buildDocResponse(OBJECT_KEY);
    workspaceDocumentService.findByMultipleWorkspaces.mockResolvedValue({ documents: [doc] });

    const result = await service.generateCitationUrl({
      source: 'report.pdf',
      fileName: 'report.pdf',
      workspaceId: WS_ID,
      agentKnowledgeBaseIds: [],
    });

    expect(workspaceDocumentService.findByMultipleWorkspaces).toHaveBeenCalledWith([WS_ID], {
      search: 'report.pdf',
      limit: 20,
      page: 1,
    });
    expect(documentService.exists).toHaveBeenCalledWith(OBJECT_KEY);
    expect(workspaceDocumentService.generateReadUrl).toHaveBeenCalledWith(OBJECT_KEY);
    expect(result.downloadUrl).toBe('https://ceph.example/signed-url');
  });

  it('throws when document storage is unavailable', async () => {
    const { service, documentService } = createCitationService();
    documentService.isAvailable.mockReturnValue(false);

    await expect(
      service.generateCitationUrl({
        source: OBJECT_KEY,
        agentKnowledgeBaseIds: [WS_ID],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws when citation has no file identifier', async () => {
    const { service } = createCitationService();

    await expect(
      service.generateCitationUrl({
        source: '   ',
        agentKnowledgeBaseIds: [WS_ID],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when no workspace scope is available', async () => {
    const { service } = createCitationService();

    await expect(
      service.generateCitationUrl({
        source: OBJECT_KEY,
        agentKnowledgeBaseIds: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when citation path is outside allowed workspace prefixes', async () => {
    const { service, workspaceService } = createCitationService();
    workspaceService.getStorageContext.mockResolvedValue({
      ownerUserId: 'other-user',
      storagePrefix: 'other-prefix',
    });

    await expect(
      service.generateCitationUrl({
        source: OBJECT_KEY,
        agentKnowledgeBaseIds: [WS_ID],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when blob is missing in object storage', async () => {
    const { service, documentService, workspaceDocumentService } = createCitationService();
    documentService.exists.mockResolvedValue(false);

    await expect(
      service.generateCitationUrl({
        source: OBJECT_KEY,
        fileName: 'report.pdf',
        agentKnowledgeBaseIds: [WS_ID],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(workspaceDocumentService.generateReadUrl).not.toHaveBeenCalled();
  });

  it('resolves blob via folder listing when stored path is stale', async () => {
    const { service, documentService, workspaceDocumentService } = createCitationService();
    const stalePath = `${OWNER_ID}/prefix/stale-report.pdf`;
    const resolvedPath = `${OWNER_ID}/prefix/report.pdf`;
    documentService.exists.mockImplementation(async (key: string) => key === resolvedPath);
    documentService.list.mockResolvedValue({
      documents: [{ name: 'report.pdf', blobPath: resolvedPath, size: 1024 }],
    });

    const result = await service.generateCitationUrl({
      source: stalePath,
      fileName: 'report.pdf',
      agentKnowledgeBaseIds: [WS_ID],
    });

    expect(documentService.list).toHaveBeenCalledWith({
      folder: `${OWNER_ID}/prefix`,
      maxResults: 200,
    });
    expect(workspaceDocumentService.generateReadUrl).toHaveBeenCalledWith(resolvedPath);
    expect(result.downloadUrl).toBe('https://ceph.example/signed-url');
  });
});
