import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { GovernanceDocumentTransitionService } from './governance-document-transition.service';

describe('GovernanceDocumentTransitionService', () => {
  const actorId = new Types.ObjectId().toString();
  const programId = new Types.ObjectId().toString();
  const documentId = new Types.ObjectId().toString();

  function setup(status = 'approved', validityStatus = 'valid') {
    const record = { id: new Types.ObjectId().toString(), documentId, workspaceId: new Types.ObjectId().toString(), status, governanceRevision: 2, validity: { businessStatus: validityStatus } };
    const updated = { ...record, status: 'published' };
    const documentStore = { updateGuarded: jest.fn().mockResolvedValue(updated) };
    const workspaceDocuments = { findOne: jest.fn().mockResolvedValue({ id: 'doc-1', status: 'completed', indexingStatus: 'ready', isFolder: false }) };
    const documents = { findRecord: jest.fn().mockResolvedValue(record) };
    const events = { findByDeduplicationKey: jest.fn().mockResolvedValue(null), append: jest.fn().mockResolvedValue(undefined) };
    return { service: new GovernanceDocumentTransitionService(documentStore as never, workspaceDocuments as never, documents as never, events as never), documentStore, workspaceDocuments, events };
  }

  it('publishes an approved, indexed document and records the transition', async () => {
    const { service, documentStore, events } = setup();
    await expect(service.transition({ commandId: 'command-1', expectedGovernanceRevision: 2, actorId, programId, documentId, target: 'published' })).resolves.toEqual(expect.objectContaining({ status: 'published' }));
    expect(documentStore.updateGuarded).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ governanceRevision: 2, statusEquals: 'approved' }), expect.objectContaining({ bumpGovernanceRevision: true }));
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'document.published', documentId, deduplicationKey: 'transition:command-1' }));
  });

  it('blocks publication when validity is expired', async () => {
    const { service, documentStore } = setup('approved', 'expired');
    await expect(service.transition({ commandId: 'command-2', expectedGovernanceRevision: 2, actorId, programId, documentId, target: 'published' })).rejects.toBeInstanceOf(BadRequestException);
    expect(documentStore.updateGuarded).not.toHaveBeenCalled();
  });

  it('returns the current record for a duplicate command', async () => {
    const setupResult = setup('captured');
    setupResult.events.findByDeduplicationKey.mockResolvedValue({ id: new Types.ObjectId().toString() });
    await expect(setupResult.service.transition({ commandId: 'command-3', expectedGovernanceRevision: 1, actorId, programId, documentId, target: 'to_review' })).resolves.toEqual(expect.objectContaining({ status: 'captured' }));
    expect(setupResult.documentStore.updateGuarded).not.toHaveBeenCalled();
  });
});
