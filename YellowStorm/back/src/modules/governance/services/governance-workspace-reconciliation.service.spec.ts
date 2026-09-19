import { Types } from 'mongoose';
import { GovernanceWorkspaceReconciliationService } from './governance-workspace-reconciliation.service';

describe('GovernanceWorkspaceReconciliationService', () => {
  const bindingId = new Types.ObjectId().toString();
  const workspaceId = new Types.ObjectId().toString();
  const programId = new Types.ObjectId().toString();
  const createdBy = new Types.ObjectId().toString();
  const binding = { id: bindingId, programId, workspaceId, ingestionMode: 'assisted', createdBy };
  const document = { id: new Types.ObjectId().toString(), workspaceId };

  function createService(existing: unknown = null) {
    const workspaceDocumentReadPort = { find: jest.fn().mockResolvedValue([document]), exists: jest.fn().mockResolvedValue(true) };
    const documentStore = {
      findByProgramAndDocumentId: jest.fn().mockResolvedValue(existing),
      listByIdCursor: jest.fn().mockResolvedValue([]),
      updateGuarded: jest.fn().mockResolvedValue(null),
    };
    const documents = { upsertFromWorkspace: jest.fn().mockResolvedValue({ id: new Types.ObjectId().toString() }) };
    const runStore = { create: jest.fn(), claim: jest.fn(), renewLease: jest.fn(), checkpoint: jest.fn(), completeIfLeased: jest.fn(), failIfLeased: jest.fn(), findById: jest.fn() };
    const service = new GovernanceWorkspaceReconciliationService(
      { findById: jest.fn().mockResolvedValue(binding) } as never,
      workspaceDocumentReadPort as never,
      documentStore as never,
      runStore as never,
      documents as never,
    );
    return { service, documents, runStore, documentStore };
  }

  it('reports missing governance documents without writing in dry-run', async () => {
    const { service, documents } = createService();
    const result = await service.reconcileBinding(bindingId, true);
    expect(result.missingGovernanceDocuments).toBe(1);
    expect(result.createdGovernanceDocuments).toBe(0);
    expect(documents.upsertFromWorkspace).not.toHaveBeenCalled();
  });

  it('creates missing governance documents in apply mode', async () => {
    const { service, documents } = createService();
    const result = await service.reconcileBinding(bindingId, false);
    expect(result.createdGovernanceDocuments).toBe(1);
    expect(documents.upsertFromWorkspace).toHaveBeenCalledWith(programId, document.id, createdBy);
  });

  it('claims a durable run with a lease token, checkpoints, and completes it', async () => {
    const runId = new Types.ObjectId().toString();
    const run = { id: runId, bindingId, dryRun: true, status: 'running', stats: {}, errors: [], cursor: 'scan:' };
    const claimedRun = { ...run, cursor: undefined };
    const runStore = {
      create: jest.fn().mockResolvedValue({ ...run, status: 'pending' }),
      claim: jest.fn().mockResolvedValue({ run: claimedRun, leaseToken: 'lease-1' }),
      renewLease: jest.fn().mockResolvedValue(true),
      checkpoint: jest.fn().mockResolvedValue(true),
      completeIfLeased: jest.fn().mockResolvedValue({ ...claimedRun, status: 'completed', cursor: undefined }),
      failIfLeased: jest.fn(),
      findById: jest.fn().mockResolvedValue(run),
    };
    const service = new GovernanceWorkspaceReconciliationService(
      { findById: jest.fn().mockResolvedValue(binding) } as never,
      { find: jest.fn().mockResolvedValue([]), exists: jest.fn().mockResolvedValue(true) } as never,
      { findByProgramAndDocumentId: jest.fn().mockResolvedValue(null), listByIdCursor: jest.fn().mockResolvedValue([]) } as never,
      runStore as never,
      { upsertFromWorkspace: jest.fn() } as never,
    );

    const completed = await service.createRun(bindingId, true);

    expect(runStore.claim).toHaveBeenCalledWith(runId, expect.any(Date), expect.any(Number));
    // Heartbeats fire every 10 scanned documents; empty batches skip them.
    expect(runStore.checkpoint).toHaveBeenCalledWith(runId, 'lease-1', 'archive:', expect.any(Object), expect.any(Array), expect.any(Number));
    expect(runStore.completeIfLeased).toHaveBeenCalledWith(runId, 'lease-1', expect.any(Object), expect.any(Array));
    expect(completed.status).toBe('completed');
    // Lease internals never leave the service (former Mongo toJSON strip).
    expect((completed as Record<string, unknown>).leaseToken).toBeUndefined();
    expect((completed as Record<string, unknown>).leaseExpiresAt).toBeUndefined();
  });

  it('returns the unchanged run when another worker holds the lease', async () => {
    const runId = new Types.ObjectId().toString();
    const runningElsewhere = { id: runId, bindingId, dryRun: true, status: 'running', stats: {}, errors: [], leaseToken: 'other-lease' };
    const runStore = {
      create: jest.fn().mockResolvedValue(runningElsewhere),
      claim: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(runningElsewhere),
    };
    const service = new GovernanceWorkspaceReconciliationService(
      { findById: jest.fn().mockResolvedValue(binding) } as never,
      {} as never,
      {} as never,
      runStore as never,
      {} as never,
    );

    const result = await service.createRun(bindingId, true);
    expect(result.status).toBe('running');
  });
});
