import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { GovernanceDocumentService } from './governance-document.service';

describe('GovernanceDocumentService', () => {
  const actorId = new Types.ObjectId().toString();
  const programId = new Types.ObjectId().toString();
  const documentId = new Types.ObjectId().toString();

  function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { id: new Types.ObjectId().toString(), programId, documentId, workspaceId: new Types.ObjectId().toString(), governanceRevision: 0, status: 'captured', validity: {}, tags: [], metadata: {}, createdAt: new Date(), updatedAt: new Date(), ...overrides };
  }

  function setup(binding: Record<string, unknown> | null) {
    const workspaceId = new Types.ObjectId().toString();
    const workspaceDocument = { id: documentId, workspaceId, isFolder: false };
    const governed = record({ workspaceId });
    const workspaceDocuments = { findOne: jest.fn().mockResolvedValue(workspaceDocument) };
    const bindingStore = { findByProgramAndWorkspace: jest.fn().mockResolvedValue(binding) };
    const documentStore = { upsertFromWorkspace: jest.fn().mockResolvedValue(governed), archiveFromWorkspaceDeletion: jest.fn().mockResolvedValue(governed), findByProgramAndDocumentId: jest.fn().mockResolvedValue(governed), updateGuarded: jest.fn().mockResolvedValue(null) };
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceDocumentService(documentStore as never, workspaceDocuments as never, bindingStore as never, {} as never, { getAccessibleScopeIds: jest.fn().mockResolvedValue(['*']) } as never, events as never, {} as never);
    return { service, documentStore, events, workspaceId };
  }

  it('creates one overlay from an enabled workspace binding', async () => {
    const binding = { enabled: true, defaults: { validityMode: 'until_replaced', reviewFrequencyDays: 90 } };
    const { service, documentStore, events } = setup(binding);
    await expect(service.upsertFromWorkspace(programId, documentId, actorId)).resolves.toEqual(expect.objectContaining({ documentId }));
    expect(documentStore.upsertFromWorkspace).toHaveBeenCalledWith(expect.objectContaining({ programId, documentId, validity: expect.objectContaining({ mode: 'until_replaced', reviewFrequencyDays: 90 }) }));
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'document.governance_created', documentId }));
  });

  it('rejects ingestion when no enabled binding grants access', async () => {
    const { service, documentStore } = setup(null);
    await expect(service.upsertFromWorkspace(programId, documentId, actorId)).rejects.toBeInstanceOf(BadRequestException);
    expect(documentStore.upsertFromWorkspace).not.toHaveBeenCalled();
  });

  it('archives an overlay idempotently after the workspace artifact is deleted', async () => {
    const { service, documentStore, events } = setup({ enabled: true, defaults: {} });
    const occurredAt = new Date('2026-07-30T12:00:00.000Z');
    await expect(service.archiveFromWorkspaceDeletion(programId, documentId, actorId, { id: 'deleted-1', occurredAt })).resolves.toBeUndefined();
    expect(documentStore.archiveFromWorkspaceDeletion).toHaveBeenCalledWith(programId, documentId, actorId, { id: 'deleted-1', occurredAt });
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'document.archived', deduplicationKey: 'workspace-deleted:deleted-1' }));
  });

  it('rejects an edit based on a stale governance revision', async () => {
    const staleRecord = record({ governanceRevision: 3 });
    const documentStore = { findByProgramAndDocumentId: jest.fn().mockResolvedValue(staleRecord), updateGuarded: jest.fn() };
    const bindings = { listEnabled: jest.fn().mockResolvedValue([{ workspaceId: staleRecord.workspaceId }]) };
    const access = { getAccessibleScopeIds: jest.fn().mockResolvedValue(['*']) };
    const service = new GovernanceDocumentService(documentStore as never, { findOne: jest.fn().mockResolvedValue({ id: documentId, isFolder: false }) } as never, bindings as never, {} as never, access as never, { append: jest.fn() } as never, {} as never);

    await expect(service.update(actorId, programId, documentId, { expectedGovernanceRevision: 2, tags: ['policy'] })).rejects.toBeInstanceOf(ConflictException);
    expect(documentStore.updateGuarded).not.toHaveBeenCalled();
  });
});
