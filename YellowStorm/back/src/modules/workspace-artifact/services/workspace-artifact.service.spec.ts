import { Types } from 'mongoose';
import { WorkspaceArtifactStatus, WorkspaceArtifactType } from '../interfaces/workspace-artifact.interface';
import { WorkspaceArtifactService } from './workspace-artifact.service';

describe('WorkspaceArtifactService', () => {
  const workspaceId = new Types.ObjectId().toString();
  const artifactId = new Types.ObjectId().toString();
  const baseArtifact = {
    _id: new Types.ObjectId(artifactId),
    id: artifactId,
    workspaceId: new Types.ObjectId(workspaceId),
    type: WorkspaceArtifactType.DECISION_FLOW,
    name: 'Flow',
    status: WorkspaceArtifactStatus.READY,
    revision: 2,
  };
  const artifacts = {
    findOne: jest.fn(),
    deleteOne: jest.fn(),
  };
  const service = new WorkspaceArtifactService(
    artifacts as never,
    {} as never,
    {} as never,
    {} as never,
    { validate: jest.fn((value) => value) } as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rejects a stale revision before persisting', async () => {
    artifacts.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(baseArtifact) });
    await expect(service.update(workspaceId, artifactId, new Types.ObjectId().toString(), { expectedRevision: 1, name: 'Changed' })).rejects.toMatchObject({ code: 'ERR_1966' });
  });

  it('rejects deletion while generation is active', async () => {
    artifacts.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ ...baseArtifact, status: WorkspaceArtifactStatus.GENERATING }) });
    await expect(service.delete(workspaceId, artifactId)).rejects.toThrow('cannot be deleted');
    expect(artifacts.deleteOne).not.toHaveBeenCalled();
  });
});
