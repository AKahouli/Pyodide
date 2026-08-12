import { Types } from 'mongoose';
import { WorkspaceIntegrationEvents } from '@modules/integration-events/contracts';
import { WorkspaceGovernanceEventHandler } from './workspace-governance-event.handler';

describe('WorkspaceGovernanceEventHandler', () => {
  const programId = new Types.ObjectId();
  const documentId = new Types.ObjectId().toString();
  const binding = { _id: new Types.ObjectId(), programId, ingestionMode: 'assisted', createdBy: new Types.ObjectId() };
  const payload = { workspaceId: new Types.ObjectId().toString(), documentId, documentType: 'doc' as const, originalName: 'Policy.pdf', contentHash: 'hash-1', indexingAttemptId: 'attempt-1' };

  function createHandler(eventConsumerEnabled = true) {
    const documents = { upsertFromWorkspace: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }), archiveFromWorkspaceDeletion: jest.fn().mockResolvedValue(undefined) };
    const intelligence = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const handler = new WorkspaceGovernanceEventHandler(
      { register: jest.fn() } as never,
      { get: jest.fn().mockReturnValue(eventConsumerEnabled) } as never,
      { enabledForWorkspace: jest.fn().mockResolvedValue([binding]) } as never,
      documents as never,
      intelligence as never,
      { getSettings: jest.fn().mockResolvedValue({ connectorId: new Types.ObjectId().toString() }) } as never,
    );
    return { handler, documents, intelligence };
  }

  it('upserts one governance overlay for each effective binding', async () => {
    const { handler, documents } = createHandler();
    const occurredAt = new Date();
    await handler.handle({ eventId: 'registered-1', eventType: WorkspaceIntegrationEvents.DocumentRegisteredV1, occurredAt, payload } as never);
    expect(documents.upsertFromWorkspace).toHaveBeenCalledWith(programId.toString(), documentId, binding.createdBy.toString(), { id: 'registered-1', occurredAt });
  });

  it('enqueues document-keyed intelligence after indexing is ready', async () => {
    const { handler, intelligence } = createHandler();
    await handler.handle({ eventId: 'ready-1', eventType: WorkspaceIntegrationEvents.IndexingReadyV1, occurredAt: new Date(), payload } as never);
    expect(intelligence.enqueue).toHaveBeenCalledWith(expect.objectContaining({ programId: programId.toString(), documentId, jobType: 'technical_metadata', inputHash: expect.any(String) }));
  });

  it('archives governance without loading a deleted workspace document', async () => {
    const { handler, documents, intelligence } = createHandler();
    const occurredAt = new Date();
    await handler.handle({ eventId: 'deleted-1', eventType: WorkspaceIntegrationEvents.DocumentDeletedV1, occurredAt, payload } as never);
    expect(documents.archiveFromWorkspaceDeletion).toHaveBeenCalledWith(programId.toString(), documentId, binding.createdBy.toString(), { id: 'deleted-1', occurredAt });
    expect(documents.upsertFromWorkspace).not.toHaveBeenCalled();
    expect(intelligence.enqueue).not.toHaveBeenCalled();
  });

  it('does not process disabled consumers', async () => {
    const { handler, documents } = createHandler(false);
    await handler.handle({ eventId: 'ready-1', eventType: WorkspaceIntegrationEvents.IndexingReadyV1, occurredAt: new Date(), payload } as never);
    expect(documents.upsertFromWorkspace).not.toHaveBeenCalled();
  });
});
