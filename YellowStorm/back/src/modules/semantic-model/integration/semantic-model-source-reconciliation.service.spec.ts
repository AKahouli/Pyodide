import { WorkspaceIntegrationEvents } from '@modules/integration-events/contracts';
import { SemanticModelSourceReconciliationService } from './semantic-model-source-reconciliation.service';

describe('SemanticModelSourceReconciliationService', () => {
  it('sweeps only selected mappings and relays current snapshots and missed deletions', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [
      { workspaceId: 'workspace-1', documentId: 'document-1', headEventId: 'old-event' },
      { workspaceId: 'workspace-1', documentId: 'document-missing', headEventId: 'registered-event' },
    ] }) };
    const document = {
      id: 'document-1', workspaceId: 'workspace-1', createdBy: 'user-1', type: 'doc',
      originalName: 'report.pdf', mimeType: 'application/pdf', size: 10, status: 'completed',
      indexingStatus: 'ready', isFolder: false, createdAt: '2026-09-20T10:00:00Z',
      updatedAt: '2026-09-20T12:00:00Z',
    };
    const documents = { findByIdsInWorkspace: jest.fn()
      .mockResolvedValueOnce([document]).mockResolvedValueOnce([]) };
    const relay = { handle: jest.fn().mockResolvedValue(undefined) };
    const service = new SemanticModelSourceReconciliationService(
      { runtimeEnabled: true, runtimeWritesEnabled: true } as any,
      database as any, documents as any, relay as any,
    );

    await service.reconcile();

    expect(database.query.mock.calls[0][0]).toContain('semantic_model.source_mappings');
    expect(relay.handle).toHaveBeenCalledTimes(2);
    expect(relay.handle.mock.calls[0][0]).toMatchObject({
      eventType: WorkspaceIntegrationEvents.IndexingReadyV1,
      occurredAt: new Date('2026-09-20T12:00:00Z'),
    });
    expect(relay.handle.mock.calls[1][0]).toMatchObject({
      eventType: WorkspaceIntegrationEvents.DocumentDeletedV1,
      payload: { workspaceId: 'workspace-1', documentId: 'document-missing' },
    });
    expect(relay.handle.mock.calls[0][0].eventId).toMatch(/^reconcile:[a-f0-9]{64}$/);
  });

  it('does not overlap sweeps or run when writes are disabled', async () => {
    const database = { query: jest.fn() };
    const service = new SemanticModelSourceReconciliationService(
      { runtimeEnabled: true, runtimeWritesEnabled: false } as any,
      database as any, {} as any, {} as any,
    );
    await service.reconcile();
    expect(database.query).not.toHaveBeenCalled();
  });
});
