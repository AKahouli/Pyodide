import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { GovernanceDocumentTransitionService } from './governance-document-transition.service';

describe('GovernanceDocumentTransitionService', () => {
  const actorId = new Types.ObjectId().toString();
  const programId = new Types.ObjectId().toString();
  const documentId = new Types.ObjectId().toString();

  function setup(status = 'approved', validityStatus = 'valid') {
    const record = { _id: new Types.ObjectId(), documentId: new Types.ObjectId(documentId), workspaceId: new Types.ObjectId(), status, governanceRevision: 2, validity: { businessStatus: validityStatus } };
    const updated = { ...record, status: 'published' };
    const model = { findOneAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(updated) })) };
    const workspaceDocuments = { findOne: jest.fn(() => ({ lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue({ status: 'completed', indexingStatus: 'ready' }) })) };
    const documents = { findRecord: jest.fn().mockResolvedValue(record) };
    const events = { findByDeduplicationKey: jest.fn().mockResolvedValue(null), append: jest.fn().mockResolvedValue(undefined) };
    return { service: new GovernanceDocumentTransitionService(model as never, workspaceDocuments as never, documents as never, events as never), model, workspaceDocuments, events };
  }

  it('publishes an approved, indexed document and records the transition', async () => {
    const { service, model, events } = setup();
    await expect(service.transition({ commandId: 'command-1', expectedGovernanceRevision: 2, actorId, programId, documentId, target: 'published' })).resolves.toEqual(expect.objectContaining({ status: 'published' }));
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', governanceRevision: 2 }), expect.anything(), { new: true });
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'document.published', documentId }));
  });

  it('blocks publication when validity is expired', async () => {
    const { service, model } = setup('approved', 'expired');
    await expect(service.transition({ commandId: 'command-2', expectedGovernanceRevision: 2, actorId, programId, documentId, target: 'published' })).rejects.toBeInstanceOf(BadRequestException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns the current record for a duplicate command', async () => {
    const setupResult = setup('captured');
    setupResult.events.findByDeduplicationKey.mockResolvedValue({ _id: new Types.ObjectId() });
    await expect(setupResult.service.transition({ commandId: 'command-3', expectedGovernanceRevision: 1, actorId, programId, documentId, target: 'to_review' })).resolves.toEqual(expect.objectContaining({ status: 'captured' }));
    expect(setupResult.model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
