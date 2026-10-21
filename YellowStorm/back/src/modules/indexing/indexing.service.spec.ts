import { IndexingService } from './indexing.service';
import type { WorkspaceDocumentRecord } from '../workspace/ports';

describe('IndexingService.deleteDocumentIndex', () => {
  it('passes the workspace ID and stored file identifiers without a workspace lookup', async () => {
    const service = Object.create(IndexingService.prototype) as IndexingService;
    const deleteIndex = jest.fn().mockResolvedValue({ success: true });
    const findOne = jest.fn().mockResolvedValue({
      workspaceId: 'workspace-1',
      path: 'files/report.pdf',
      filename: 'report.pdf',
      originalName: 'Original Report.pdf',
    });
    Object.assign(service, {
      enabled: true,
      documentReadPort: { findOne },
      indexingClient: { deleteIndex },
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });

    await service.deleteDocumentIndex('document-1', 'workspace-1');

    expect(findOne).toHaveBeenCalledWith({ id: 'document-1', workspaceId: 'workspace-1', includeDeleted: true });
    expect(deleteIndex).toHaveBeenCalledWith({
      documentId: 'document-1',
      workspaceId: 'workspace-1',
      filePath: 'files/report.pdf',
      fileName: 'report.pdf',
    });
  });

  it.each([{ success: false }, new Error('index offline')])('reports cleanup failure to strict callers while preserving ordinary best-effort deletion: %p', async result => {
    const service = Object.create(IndexingService.prototype) as IndexingService;
    const deleteIndex = result instanceof Error ? jest.fn().mockRejectedValue(result) : jest.fn().mockResolvedValue(result);
    Object.assign(service, { enabled: true, documentReadPort: { findOne: jest.fn().mockResolvedValue({ path: 'file', originalName: 'report.pdf' }) },
      indexingClient: { deleteIndex }, logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } });
    await expect(service.deleteDocumentIndex('d', 'w', true)).rejects.toThrow();
    await expect(service.deleteDocumentIndex('d', 'w')).resolves.toBeUndefined();
  });

  it('does not call disabled indexing cleanup complete for a strict caller', async () => {
    const service = Object.create(IndexingService.prototype) as IndexingService;
    Object.assign(service, { enabled: false, logger: { debug: jest.fn() } });
    await expect(service.deleteDocumentIndex('d', 'w', true)).rejects.toThrow('unavailable');
  });
});

describe('IndexingService CODE_ONLY guard', () => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  function buildService(document: WorkspaceDocumentRecord | null) {
    const service = Object.create(IndexingService.prototype) as IndexingService;
    Object.assign(service as object, {
      enabled: true,
      documentReadPort: { findById: jest.fn().mockResolvedValue(document) },
      logger,
    });
    return service;
  }

  it('processDocument refuses a CODE_ONLY conversation attachment', async () => {
    const document = {
      id: 'doc-1',
      workspaceId: 'system-1',
      status: 'completed',
      indexingStatus: 'pending',
      metadata: { attachmentPolicy: 'CODE_ONLY' },
    };

    await buildService(document as unknown as WorkspaceDocumentRecord).processDocument('doc-1');

    expect(logger.warn).toHaveBeenCalledWith(
      'Blocked processing of CODE_ONLY conversation attachment',
      expect.objectContaining({ documentId: 'doc-1' }),
    );
  });

  it('queueDocument refuses a CODE_ONLY conversation attachment', async () => {
    const document = {
      id: 'doc-1',
      workspaceId: 'system-1',
      status: 'completed',
      indexingStatus: 'none',
      metadata: { attachmentPolicy: 'CODE_ONLY' },
    } as unknown as WorkspaceDocumentRecord;

    await buildService(document).queueDocument('doc-1');

    expect(logger.warn).toHaveBeenCalledWith(
      'Blocked indexing of CODE_ONLY conversation attachment',
      expect.objectContaining({ documentId: 'doc-1' }),
    );
  });
});

describe('IndexingService local failure notifications', () => {
  it.each(['submission', 'timeout'] as const)('publishes the persisted failed state for %s failures', async source => {
    const document = { id: 'doc-1', workspaceId: 'workspace-1', createdBy: 'owner-1',
      originalName: 'report.pdf', filename: 'report.pdf', status: 'completed', indexingStatus: 'pending',
      path: 'owner/workspace/report.pdf', mimeType: 'application/pdf', size: 10, isFolder: false,
      type: 'doc', createdAt: new Date(), updatedAt: new Date(), metadata: {} } satisfies WorkspaceDocumentRecord;
    const sendToUser = jest.fn().mockResolvedValue(undefined);
    const updateIndexingState = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(IndexingService.prototype) as IndexingService;
    Object.assign(service, { enabled: true, batchSize: 10, indexingTimeoutMs: 3600000,
      documentReadPort: {findById: jest.fn().mockResolvedValue(document),
        find: jest.fn().mockResolvedValue([{...document,indexingStatus:'processing'}])},
      documentWritePort: {updateIndexingState}, workspaceReadPort: {findById: jest.fn().mockResolvedValue({storagePrefix:'workspace'})},
      workspaceSettingReadPort: {}, documentService: {getBlobUrl: jest.fn().mockReturnValue('https://example.test/report.pdf')},
      indexingClient: {indexDocument: jest.fn().mockRejectedValue(new Error('Indexing API unavailable'))},
      notificationsService: {sendToUser},
      logger: {debug:jest.fn(),log:jest.fn(),warn:jest.fn(),error:jest.fn()},
    });
    if (source === 'submission') await expect(service.processDocument(document.id)).rejects.toThrow('Indexing API unavailable');
    else await service.timeoutStaleIndexing();
    expect(updateIndexingState).toHaveBeenLastCalledWith('doc-1', expect.objectContaining({indexingStatus:'failed'}));
    expect(sendToUser).toHaveBeenLastCalledWith('owner-1',expect.objectContaining({type:'error',
      data:expect.objectContaining({indexingStatus:'failed',indexingError:expect.any(String)})}));
  });
});
