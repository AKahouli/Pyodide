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

    expect(findOne).toHaveBeenCalledWith({ id: 'document-1', workspaceId: 'workspace-1' });
    expect(deleteIndex).toHaveBeenCalledWith({
      documentId: 'document-1',
      workspaceId: 'workspace-1',
      filePath: 'files/report.pdf',
      fileName: 'report.pdf',
    });
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
