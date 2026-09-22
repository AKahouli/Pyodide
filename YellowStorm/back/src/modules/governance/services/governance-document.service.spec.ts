import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { GovernanceDocumentService } from './governance-document.service';

describe('GovernanceDocumentService', () => {
  const tx = { run: jest.fn((fn: () => Promise<unknown>) => fn()) };
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
    const service = new GovernanceDocumentService(documentStore as never, workspaceDocuments as never, bindingStore as never, {} as never, { getAccessibleScopeIds: jest.fn().mockResolvedValue(['*']) } as never, events as never, {} as never, tx as never);
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
    const service = new GovernanceDocumentService(documentStore as never, { findOne: jest.fn().mockResolvedValue({ id: documentId, isFolder: false }) } as never, bindings as never, {} as never, access as never, { append: jest.fn() } as never, {} as never, tx as never);

    await expect(service.update(actorId, programId, documentId, { expectedGovernanceRevision: 2, tags: ['policy'] })).rejects.toBeInstanceOf(ConflictException);
    expect(documentStore.updateGuarded).not.toHaveBeenCalled();
  });

  it('archives the surviving governance row on workspace deletion inside one transaction', async () => {
    const { service, documentStore, events } = setup({ enabled: true, defaults: {} });
    tx.run.mockClear();
    await service.archiveFromWorkspaceDeletion(programId, documentId, actorId, { id: 'deleted-2', occurredAt: new Date() });
    expect(tx.run).toHaveBeenCalledTimes(1);
    expect(documentStore.archiveFromWorkspaceDeletion.mock.invocationCallOrder[0]).toBeLessThan(events.append.mock.invocationCallOrder[0]);
  });

  it('does not append an archive event when no live governance row matched', async () => {
    const { service, documentStore, events } = setup({ enabled: true, defaults: {} });
    documentStore.archiveFromWorkspaceDeletion.mockResolvedValue(null);
    await service.archiveFromWorkspaceDeletion(programId, documentId, actorId, { id: 'deleted-3', occurredAt: new Date() });
    expect(events.append).not.toHaveBeenCalled();
  });

  describe('deleteGovernance', () => {
    function deletion(deleteResult: boolean) {
      const archived = record({ status: 'archived', governanceRevision: 4 });
      const documentStore = { findByProgramAndDocumentId: jest.fn().mockResolvedValue(archived), deleteByIdGuarded: jest.fn().mockResolvedValue(deleteResult) };
      const bindings = { listEnabled: jest.fn().mockResolvedValue([{ workspaceId: archived.workspaceId }]) };
      const events = { append: jest.fn().mockResolvedValue(undefined) };
      const service = new GovernanceDocumentService(documentStore as never, {} as never, bindings as never, {} as never, { getAccessibleScopeIds: jest.fn().mockResolvedValue(['*']) } as never, events as never, {} as never, tx as never);
      return { service, documentStore, events, archived };
    }

    it('appends the deletion event before deleting, in one transaction', async () => {
      const { service, documentStore, events, archived } = deletion(true);
      tx.run.mockClear();
      await service.deleteGovernance(actorId, programId, documentId, true, 4);
      expect(tx.run).toHaveBeenCalledTimes(1);
      expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'document.governance_deleted', governanceDocumentId: archived.id }));
      expect(events.append.mock.invocationCallOrder[0]).toBeLessThan(documentStore.deleteByIdGuarded.mock.invocationCallOrder[0]);
    });

    it('throws a conflict (rolling back the event) when the guarded delete loses a race', async () => {
      const { service } = deletion(false);
      await expect(service.deleteGovernance(actorId, programId, documentId, true, 4)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
