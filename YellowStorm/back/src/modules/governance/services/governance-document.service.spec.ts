import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { GovernanceDocumentService } from './governance-document.service';

describe('GovernanceDocumentService', () => {
  const actorId = new Types.ObjectId().toString();
  const programId = new Types.ObjectId().toString();
  const documentId = new Types.ObjectId().toString();

  function setup(binding: Record<string, unknown> | null) {
    const workspaceId = new Types.ObjectId();
    const workspaceDocument = { _id: new Types.ObjectId(documentId), workspaceId };
    const governed = { _id: new Types.ObjectId(), programId: new Types.ObjectId(programId), documentId: workspaceDocument._id, workspaceId };
    const workspaceDocuments = { findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(workspaceDocument) })) };
    const bindings = { findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(binding) })) };
    const model = { findOneAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(governed) })) };
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceDocumentService(model as never, workspaceDocuments as never, bindings as never, {} as never, {} as never, events as never, {} as never);
    return { service, model, events, workspaceId };
  }

  it('creates one overlay from an enabled workspace binding', async () => {
    const binding = { defaults: { validityMode: 'until_replaced', reviewFrequencyDays: 90 } };
    const { service, model, events, workspaceId } = setup(binding);
    await expect(service.upsertFromWorkspace(programId, documentId, actorId)).resolves.toEqual(expect.objectContaining({ documentId: new Types.ObjectId(documentId) }));
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { programId: new Types.ObjectId(programId), documentId: new Types.ObjectId(documentId) },
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ workspaceId, status: 'captured', validity: expect.objectContaining({ mode: 'until_replaced', reviewFrequencyDays: 90 }) }) }),
      expect.objectContaining({ upsert: true }),
    );
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'document.governance_created', documentId }));
  });

  it('rejects ingestion when no enabled binding grants access', async () => {
    const { service, model } = setup(null);
    await expect(service.upsertFromWorkspace(programId, documentId, actorId)).rejects.toBeInstanceOf(BadRequestException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('archives an overlay idempotently after the workspace artifact is deleted', async () => {
    const { service, model, events } = setup({ defaults: {} });
    const occurredAt = new Date('2026-07-30T12:00:00.000Z');
    await expect(service.archiveFromWorkspaceDeletion(programId, documentId, actorId, { id: 'deleted-1', occurredAt })).resolves.toBeUndefined();
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: new Types.ObjectId(documentId), lastIntegrationEventId: { $ne: 'deleted-1' } }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'archived', lastIntegrationEventId: 'deleted-1' }) }),
      { new: true },
    );
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'document.archived', deduplicationKey: 'workspace-deleted:deleted-1' }));
  });

  it('rejects an edit based on a stale governance revision', async () => {
    const workspaceId = new Types.ObjectId();
    const record = { _id: new Types.ObjectId(), programId: new Types.ObjectId(programId), documentId: new Types.ObjectId(documentId), workspaceId, governanceRevision: 3 };
    const model = { findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(record) })), findOneAndUpdate: jest.fn() };
    const bindings = { find: jest.fn(() => ({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([{ workspaceId }]) })) };
    const access = { getAccessibleScopeIds: jest.fn().mockResolvedValue(['*']) };
    const service = new GovernanceDocumentService(model as never, {} as never, bindings as never, {} as never, access as never, {} as never, {} as never);

    await expect(service.update(actorId, programId, documentId, { expectedGovernanceRevision: 2, tags: ['policy'] })).rejects.toBeInstanceOf(ConflictException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
