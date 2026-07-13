import { Types } from 'mongoose';
import { GovernanceWorkspaceReconciliationService } from './governance-workspace-reconciliation.service';

describe('GovernanceWorkspaceReconciliationService', () => {
  const bindingId = new Types.ObjectId();
  const programId = new Types.ObjectId();
  const workspaceId = new Types.ObjectId();
  const sourceId = new Types.ObjectId();
  const documentId = new Types.ObjectId();
  const binding = { _id: bindingId, programId, workspaceId, scopeIds: [], visibility: 'program_shared', ingestionMode: 'assisted', createdBy: new Types.ObjectId() };

  function createService(overrides: { documents?: unknown[]; versions?: unknown[] } = {}) {
    const documentModel = { find: jest.fn(() => ({ lean: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(overrides.documents ?? []) })) })) };
    const versionModel = { find: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(overrides.versions ?? []) })), findOne: jest.fn() };
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceWorkspaceReconciliationService(
      { findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(binding) })) } as never,
      documentModel as never,
      { findOne: jest.fn() } as never,
      versionModel as never,
      { create: jest.fn(), updateTechnicalStatus: jest.fn() } as never,
      events as never,
    );
    return { service, documentModel, versionModel, events };
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
});
