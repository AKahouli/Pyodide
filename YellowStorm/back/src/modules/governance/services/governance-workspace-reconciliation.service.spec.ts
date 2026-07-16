import { Types } from 'mongoose';
import { GovernanceWorkspaceReconciliationService } from './governance-workspace-reconciliation.service';
import { GovernanceSourceFromWorkspaceFactory } from '../factories/governance-source-from-workspace.factory';

describe('GovernanceWorkspaceReconciliationService', () => {
  const bindingId = new Types.ObjectId();
  const programId = new Types.ObjectId();
  const workspaceId = new Types.ObjectId();
  const sourceId = new Types.ObjectId();
  const documentId = new Types.ObjectId();
  const binding = { _id: bindingId, programId, workspaceId, scopeIds: [], visibility: 'program_shared', ingestionMode: 'assisted', createdBy: new Types.ObjectId() };

  function createService(overrides: { documents?: unknown[]; versions?: unknown[] } = {}) {
    const documentQuery = { lean: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(overrides.documents ?? []) })), limit: jest.fn(), sort: jest.fn() };
    documentQuery.sort.mockReturnValue(documentQuery);
    documentQuery.limit.mockReturnValue(documentQuery);
    const documentModel = { find: jest.fn(() => documentQuery), exists: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(null) })) };
    const versionQuery = { exec: jest.fn().mockResolvedValue(overrides.versions ?? []), limit: jest.fn(), sort: jest.fn() };
    versionQuery.sort.mockReturnValue(versionQuery);
    versionQuery.limit.mockReturnValue(versionQuery);
    const versionModel = { find: jest.fn(() => versionQuery), findOne: jest.fn() };
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceWorkspaceReconciliationService(
      { findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(binding) })) } as never,
      documentModel as never,
      { findOne: jest.fn() } as never,
      versionModel as never,
      { create: jest.fn(), findById: jest.fn() } as never,
      { create: jest.fn(), updateTechnicalStatus: jest.fn() } as never,
      events as never,
      new GovernanceSourceFromWorkspaceFactory(),
    );
    return { service, documentModel, documentQuery, versionModel, events };
  }

  it('reports a missing physical artifact without writing during dry-run', async () => {
    const version = { _id: new Types.ObjectId(), sourceId, workspaceId, documentId, extractedMetadata: {}, save: jest.fn() };
    const { service, events } = createService({ versions: [version] });

    const result = await service.reconcileBinding(bindingId.toString(), true);

    expect(result.missingArtifacts).toBe(1);
    expect(version.save).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it('marks a missing artifact once and remains idempotent on later runs', async () => {
    const version = { _id: new Types.ObjectId(), sourceId, workspaceId, documentId, extractedMetadata: {}, save: jest.fn().mockResolvedValue(undefined) };
    const { service, events } = createService({ versions: [version] });

    await service.reconcileBinding(bindingId.toString(), false);
    await service.reconcileBinding(bindingId.toString(), false);

    expect(version.extractedMetadata).toEqual({ artifactAvailable: false });
    expect(version.save).toHaveBeenCalledTimes(1);
    expect(events.append).toHaveBeenCalledTimes(1);
  });

  it('uses a stable cursor and bounded query while processing persisted runs', async () => {
    const run = { _id: new Types.ObjectId(), bindingId, dryRun: true, status: 'pending', stats: {}, save: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    const documentQuery = { lean: jest.fn(() => ({ exec: jest.fn().mockResolvedValue([]) })), limit: jest.fn(), sort: jest.fn() };
    documentQuery.sort.mockReturnValue(documentQuery);
    documentQuery.limit.mockReturnValue(documentQuery);
    const service = new GovernanceWorkspaceReconciliationService(
      { findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(binding) })) } as never,
      { find: jest.fn(() => documentQuery) } as never,
      { findOne: jest.fn(), exists: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(null) })) } as never,
      { find: jest.fn(() => ({ sort: jest.fn(() => ({ limit: jest.fn(() => ({ exec: jest.fn().mockResolvedValue([]) })) })) })), findOne: jest.fn() } as never,
      { create: jest.fn().mockResolvedValue(run), findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(run) })), findOneAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(run) })), updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })) } as never,
      { create: jest.fn(), updateTechnicalStatus: jest.fn() } as never,
      { append: jest.fn() } as never,
      new GovernanceSourceFromWorkspaceFactory(),
    );

    await service.createRun(bindingId.toString(), true);

    expect(documentQuery.sort).toHaveBeenCalledWith({ _id: 1 });
    expect(documentQuery.limit).toHaveBeenCalledWith(100);
    expect(run.status).toBe('completed');
  });
});
