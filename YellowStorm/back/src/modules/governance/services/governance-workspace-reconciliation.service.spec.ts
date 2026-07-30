import { Types } from 'mongoose';
import { GovernanceWorkspaceReconciliationService } from './governance-workspace-reconciliation.service';

describe('GovernanceWorkspaceReconciliationService', () => {
  const binding = { _id: new Types.ObjectId(), programId: new Types.ObjectId(), workspaceId: new Types.ObjectId(), ingestionMode: 'assisted', createdBy: new Types.ObjectId() };
  const document = { _id: new Types.ObjectId(), workspaceId: binding.workspaceId };

  function createService(existing: unknown = null) {
    const documentQuery = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([document]) };
    const governanceQuery = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) };
    const governanceDocuments = { findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(existing) })), find: jest.fn(() => governanceQuery), updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })) };
    const documents = { upsertFromWorkspace: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) };
    const service = new GovernanceWorkspaceReconciliationService(
      { findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(binding) })) } as never,
      { find: jest.fn(() => documentQuery), exists: jest.fn().mockResolvedValue(true) } as never,
      governanceDocuments as never,
      {} as never,
      documents as never,
    );
    return { service, documents, documentQuery };
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
    expect(documents.upsertFromWorkspace).toHaveBeenCalledWith(binding.programId.toString(), document._id.toString(), binding.createdBy.toString());
  });
});
