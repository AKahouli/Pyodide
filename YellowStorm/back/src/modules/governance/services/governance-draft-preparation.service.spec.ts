import { Types } from 'mongoose';
import { GovernanceDraftPreparationService } from './governance-draft-preparation.service';

describe('GovernanceDraftPreparationService', () => {
  it('creates one immutable draft for a changed configuration and is idempotent afterward', async () => {
    const programId = new Types.ObjectId();
    const scopeId = new Types.ObjectId();
    const deploymentId = new Types.ObjectId();
    const agentId = new Types.ObjectId();
    const workspaceId = new Types.ObjectId();
    const bindingId = new Types.ObjectId();
    const createdRevisionId = new Types.ObjectId();
    const scope = { _id: scopeId, name: 'Scope', type: 'custom', status: 'active', agentIds: [agentId], metadata: { classification: { stage: 'pilot' } }, audience: { mode: 'restricted', userIds: [], groupIds: [] } };
    const deployment = { _id: deploymentId, status: 'published', channels: {}, revisionSequence: 1, currentDraftRevisionId: new Types.ObjectId() };
    let currentDraft: Record<string, unknown> = { _id: deployment.currentDraftRevisionId, status: 'published' };
    const scopeModel = {
      findOne: jest.fn(() => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(scope) }) })),
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ acknowledged: true }) })),
    };
    const sourceModel = { find: jest.fn(() => ({ select: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue([]) }) }) })) };
    const bindingModel = { find: jest.fn(() => ({ select: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue([{ _id: bindingId, workspaceId, visibility: 'scope_specific', ingestionMode: 'assisted', defaults: {} }]) }) }) })) };
    const membershipModel = { find: jest.fn(() => ({ select: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue([]) }) }) })) };
    const agentModel = { find: jest.fn(() => ({ select: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue([{ _id: agentId, name: 'Assistant', guardrails: {} }]) }) }) })) };
    const deploymentModel = {
      findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(deployment) })),
      findOneAndUpdate: jest.fn(() => ({ exec: jest.fn().mockImplementation(async () => ({ ...deployment, revisionSequence: ++deployment.revisionSequence })) })),
      updateOne: jest.fn((_filter, update) => ({ exec: jest.fn().mockImplementation(async () => { if (update.$set?.currentDraftRevisionId) deployment.currentDraftRevisionId = update.$set.currentDraftRevisionId; return { modifiedCount: update.$set?.currentDraftRevisionId ? 1 : 0 }; }) })),
    };
    const revisionModel = {
      findById: jest.fn(() => ({ lean: () => ({ exec: jest.fn().mockImplementation(async () => currentDraft) }) })),
      countDocuments: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockImplementation(async (payload) => {
        currentDraft = { ...payload, _id: createdRevisionId };
        return currentDraft;
      }),
      deleteOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) })),
    };
    const audit = { logSuccess: jest.fn() };
    const service = new GovernanceDraftPreparationService(scopeModel as never, sourceModel as never, bindingModel as never, deploymentModel as never, revisionModel as never, membershipModel as never, agentModel as never, audit as never);

    await service.prepare(new Types.ObjectId().toString(), 'actor@example.com', programId.toString(), scopeId.toString());
    await service.prepare(new Types.ObjectId().toString(), 'actor@example.com', programId.toString(), scopeId.toString());

    expect(revisionModel.create).toHaveBeenCalledTimes(1);
    expect(revisionModel.create).toHaveBeenCalledWith(expect.objectContaining({ workspaceIds: [workspaceId], sourceIds: [] }));
    expect(deployment.currentDraftRevisionId).toEqual(createdRevisionId);
    expect(scopeModel.updateOne).toHaveBeenCalledWith({ _id: scopeId }, { $set: { 'metadata.review.status': 'in_review' } });
    expect(audit.logSuccess).toHaveBeenCalledTimes(1);
  });
});
