import { WorkspaceArtifactService } from './workspace-artifact.service';
import { WorkspaceArtifactStatus, WorkspaceArtifactType } from '../interfaces/workspace-artifact.interface';
import type { WorkspaceArtifactRecord } from '../persistence/workspace-artifact-store';

describe('WorkspaceArtifactService', () => {
  const workspaceId = 'a1a1a1a1a1a1a1a1a1a1a1a1';
  const artifactId = 'b2b2b2b2b2b2b2b2b2b2b2b2';
  const userId = 'c3c3c3c3c3c3c3c3c3c3c3c3';

  function baseRecord(overrides: Partial<WorkspaceArtifactRecord> = {}): WorkspaceArtifactRecord {
    return {
      id: artifactId,
      workspaceId,
      type: WorkspaceArtifactType.DECISION_FLOW,
      name: 'Flow',
      status: WorkspaceArtifactStatus.READY,
      schemaVersion: 1,
      revision: 2,
      primarySource: { documentId: 'd1d1d1d1d1d1d1d1d1d1d1d1', documentName: 'source.pdf', selection: { mode: 'all' } },
      generationOptions: {
        flowType: 'eligibility',
        targetAudiences: ['infer_from_document'],
        detailLevel: 'standard',
        ambiguityPolicy: { doNotInvent: true, createToConfirmNodes: true, citeSourcePassages: true, identifyContradictions: true },
      },
      generation: { agentId: 'e4e4e4e4e4e4e4e4e4e4e4e4', requestedBy: userId, attempts: 1 },
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-11T00:00:00.000Z'),
      ...overrides,
    };
  }

  function createService(overrides: { artifacts?: Record<string, jest.Mock> } = {}) {
    const artifacts = {
      findByIdAndWorkspace: jest.fn().mockResolvedValue(null),
      deleteById: jest.fn().mockResolvedValue(undefined),
      existsName: jest.fn().mockResolvedValue(false),
      updateWithRevision: jest.fn().mockResolvedValue(null),
      ...overrides.artifacts,
    };
    const service = new WorkspaceArtifactService(
      artifacts as never,
      {} as never,
      {} as never,
      {} as never,
      { validate: jest.fn((value) => value) } as never,
    );
    return { service, artifacts };
  }

  beforeEach(() => jest.clearAllMocks());

  it('rejects a stale revision before persisting', async () => {
    const { service, artifacts } = createService({
      artifacts: { findByIdAndWorkspace: jest.fn().mockResolvedValue(baseRecord()) },
    });
    await expect(
      service.update(workspaceId, artifactId, userId, { expectedRevision: 1, name: 'Changed' }),
    ).rejects.toMatchObject({ code: 'ERR_1966' });
    expect(artifacts.updateWithRevision).not.toHaveBeenCalled();
  });

  it('rejects deletion while generation is active', async () => {
    const { service, artifacts } = createService({
      artifacts: {
        findByIdAndWorkspace: jest.fn().mockResolvedValue(baseRecord({ status: WorkspaceArtifactStatus.GENERATING })),
      },
    });
    await expect(service.delete(workspaceId, artifactId)).rejects.toThrow('cannot be deleted');
    expect(artifacts.deleteById).not.toHaveBeenCalled();
  });
});
