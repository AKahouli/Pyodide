import { ConfigService } from '@nestjs/config';
import { WidgetChatService } from './widget-chat.service';
import { NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { DocumentStatus, IndexingStatus } from '@modules/workspace/interfaces/document-status.enum';
import { InMemoryWidgetMessageStore, InMemoryWidgetSessionStore, InMemoryWidgetTokenStore } from '../persistence/widget.store.fake';
import { PgWidgetMessageStore, PgWidgetSessionStore, PgWidgetTokenStore } from '../persistence/pg-widget.store';

const WS_ID = '507f1f77bcf86cd799439011';
const DOC_ID = '507f1f77bcf86cd799439012';
const OWNER_ID = '507f191e810c19729de860ea';
const OBJECT_KEY = `${OWNER_ID}/prefix/report.pdf`;

function createCitationService() {
  const documentService = {
    isAvailable: jest.fn().mockReturnValue(true),
    exists: jest.fn().mockResolvedValue(true),
    list: jest.fn().mockResolvedValue({ documents: [] }),
    download: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
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
  const tokenStore = new InMemoryWidgetTokenStore();
  const sessionStore = new InMemoryWidgetSessionStore();
  const messageStore = new InMemoryWidgetMessageStore();

  const service = new WidgetChatService(
    tokenStore as unknown as PgWidgetTokenStore,
    sessionStore as unknown as PgWidgetSessionStore,
    messageStore as unknown as PgWidgetMessageStore,
    {} as any,
    {} as any,
    {} as any,
    documentService as any,
    workspaceDocumentService as any,
    workspaceService as any,
    { get: jest.fn() } as unknown as ConfigService,
    logger as any,
  );

  return { service, tokenStore, sessionStore, messageStore, documentService, workspaceDocumentService, workspaceService, logger };
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
      searchFilename: true,
    });
    expect(documentService.exists).toHaveBeenCalledWith(OBJECT_KEY);
    expect(workspaceDocumentService.generateReadUrl).toHaveBeenCalledWith(OBJECT_KEY);
    expect(result.downloadUrl).toBe('https://ceph.example/signed-url');
  });

  it('matches filename-only citations that name the storage filename when the original name differs', async () => {
    const { service, documentService, workspaceDocumentService } = createCitationService();
    const doc = { ...buildDocResponse(OBJECT_KEY), originalName: 'report original.pdf', filename: 'report.pdf' };
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
      searchFilename: true,
    });
    expect(documentService.exists).toHaveBeenCalledWith(OBJECT_KEY);
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

describe('WidgetChatService.getCitationFile', () => {
  it('downloads citation bytes via documentService when path is allowed', async () => {
    const { service, documentService, workspaceService } = createCitationService();

    const result = await service.getCitationFile({
      source: OBJECT_KEY,
      fileName: 'report.pdf',
      agentKnowledgeBaseIds: [WS_ID],
    });

    expect(workspaceService.getStorageContext).toHaveBeenCalledWith(WS_ID);
    expect(documentService.download).toHaveBeenCalledWith(OBJECT_KEY);
    expect(result.displayName).toBe('report.pdf');
    expect(result.mimeType).toBe('application/pdf');
    expect(result.buffer.toString()).toBe('%PDF-1.4');
  });

  it('throws when document storage is unavailable', async () => {
    const { service, documentService } = createCitationService();
    documentService.isAvailable.mockReturnValue(false);

    await expect(
      service.getCitationFile({
        source: OBJECT_KEY,
        fileName: 'report.pdf',
        agentKnowledgeBaseIds: [WS_ID],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('WidgetChatService sessions (PG stores, plan 4.13)', () => {
  const metadata = {};

  it('reuses the active visitor session instead of creating a new one', async () => {
    const { service, sessionStore } = createCitationService();

    const first = await service.createOrGetSession('hash-1', 'agent-1', 'visitor-1', metadata);
    const second = await service.createOrGetSession('hash-1', 'agent-1', 'visitor-1', metadata);

    expect(second.id).toBe(first.id);
    expect(sessionStore.rows).toHaveLength(1);
  });

  it('resetVisitorSession closes the active session and starts a fresh one in one transaction', async () => {
    const { service, sessionStore } = createCitationService();
    const original = await service.createOrGetSession('hash-1', 'agent-1', 'visitor-1', metadata);

    const result = await service.resetVisitorSession('hash-1', 'agent-1', 'visitor-1', metadata);

    expect(result.sessionId).not.toBe(original.id);
    const rows = sessionStore.rows;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === original.id)!.status).toBe('closed');
    expect(rows.find((r) => r.id === result.sessionId)!.status).toBe('active');
  });
});

describe('WidgetChatService tokens (PG stores, plan 4.12)', () => {
  it('hides tokenHash from list/update/revoke results', async () => {
    const { service, tokenStore } = createCitationService();
    const created = await service.createToken('agent-1', 'user-1', { label: 'CI' });

    expect(created.token).toBeDefined();
    const listed = await service.listTokens('agent-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('tokenHash');
    expect(listed[0]).toMatchObject({ id: created.id, label: 'CI', isActive: true });

    await service.updateToken('agent-1', created.id, { isActive: false });
    expect(tokenStore.rows[0].isActive).toBe(false);
    expect(tokenStore.rows[0]).toHaveProperty('tokenHash');

    const revoked = await service.revokeToken('agent-1', created.id);
    expect(revoked).not.toHaveProperty('tokenHash');
    expect(await service.listTokens('agent-1')).toHaveLength(0);
  });
});
