import { Types } from 'mongoose';
import { GovernanceWorkspaceReconciliationService } from './governance-workspace-reconciliation.service';

describe('GovernanceWorkspaceReconciliationService', () => {
  const binding = { _id: new Types.ObjectId(), programId: new Types.ObjectId(), workspaceId: new Types.ObjectId(), ingestionMode: 'assisted', createdBy: new Types.ObjectId() };
  const document = { id: new Types.ObjectId().toString(), workspaceId: binding.workspaceId.toString() };

  function createService(existing: unknown = null) {
    const workspaceDocumentReadPort = { find: jest.fn().mockResolvedValue([document]), exists: jest.fn().mockResolvedValue(true) };
    const governanceQuery = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) };
    const governanceDocuments = { findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(existing) })), find: jest.fn(() => governanceQuery), updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })) };
    const documents = { upsertFromWorkspace: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) };
    const service = new GovernanceWorkspaceReconciliationService(
      { findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(binding) })) } as never,
      workspaceDocumentReadPort as never,
      governanceDocuments as never,
      {} as never,
      documents as never,
    );
    return { service, documents, workspaceDocumentReadPort };
  }

  it('reports missing governance documents without writing in dry-run', async () => {
    const { service, documents } = createService();
    const result = await service.reconcileBinding(binding._id.toString(), true);
    expect(result.missingGovernanceDocuments).toBe(1);
    expect(result.createdGovernanceDocuments).toBe(0);
    expect(documents.upsertFromWorkspace).not.toHaveBeenCalled();
  });

  it('creates missing governance documents in apply mode', async () => {
    const { service, documents } = createService();
    const result = await service.reconcileBinding(binding._id.toString(), false);
    expect(result.createdGovernanceDocuments).toBe(1);
    expect(documents.upsertFromWorkspace).toHaveBeenCalledWith(binding.programId.toString(), document.id, binding.createdBy.toString());
  });

  it('renews its lease and checkpoints progress before completing a durable run', async () => {
    const runId = new Types.ObjectId();
    const run = { _id: runId, bindingId: binding._id, dryRun: true, status: 'pending', stats: {}, errors: [], cursor: undefined, set: jest.fn() };
    const updateOne = jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }));
    const runs = {
      create: jest.fn().mockResolvedValue({ _id: runId }),
      findOneAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(run) })),
      updateOne,
      findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(run) })),
    };
    const governanceQuery = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) };
    const service = new GovernanceWorkspaceReconciliationService(
      { findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(binding) })) } as never,
      { find: jest.fn().mockResolvedValue([document]) } as never,
      { findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), workspaceId: binding.workspaceId }) })), find: jest.fn(() => governanceQuery) } as never,
      runs as never,
      { upsertFromWorkspace: jest.fn() } as never,
    );

    await service.createRun(binding._id.toString(), true);

    expect(updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: runId, leaseToken: expect.any(String), status: 'running' }), expect.objectContaining({ $set: expect.objectContaining({ leaseExpiresAt: expect.any(Date) }) }));
    expect(updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: runId, leaseToken: expect.any(String), status: 'running' }), expect.objectContaining({ $set: expect.objectContaining({ cursor: 'archive:', stats: expect.any(Object) }) }));
    expect(updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: runId, leaseToken: expect.any(String), status: 'running' }), expect.objectContaining({ $set: expect.objectContaining({ status: 'completed' }) }));
  });
});
