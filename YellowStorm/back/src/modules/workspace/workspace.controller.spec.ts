import { WorkspaceController } from './workspace.controller';

describe('WorkspaceController', () => {
  it('cleans up Semantic Model state only after workspace deletion succeeds', async () => {
    const calls: string[] = [];
    const workspaceService = {
      delete: jest.fn().mockImplementation(async () => {
        calls.push('workspace');
      }),
    };
    const workspaceDocumentService = {
      deleteAllByWorkspace: jest.fn().mockImplementation(async () => {
        calls.push('documents');
      }),
    };
    const provisioning = {
      afterWorkspaceDeleted: jest.fn().mockImplementation(async () => {
        calls.push('semantic-model');
      }),
    };
    const controller = new WorkspaceController(
      workspaceService as never,
      workspaceDocumentService as never,
      {} as never,
      provisioning as never,
      {} as never,
    );

    await controller.delete({ _id: { toString: () => 'owner-1' } } as never, 'workspace-1');

    expect(calls).toEqual(['documents', 'workspace', 'semantic-model']);
  });

  it('does not clean up Semantic Model state when workspace deletion fails', async () => {
    const workspaceService = {
      delete: jest.fn().mockRejectedValue(new Error('delete failed')),
    };
    const workspaceDocumentService = {
      deleteAllByWorkspace: jest.fn().mockResolvedValue(undefined),
    };
    const provisioning = {
      afterWorkspaceDeleted: jest.fn(),
    };
    const controller = new WorkspaceController(
      workspaceService as never,
      workspaceDocumentService as never,
      {} as never,
      provisioning as never,
      {} as never,
    );

    await expect(
      controller.delete({ _id: { toString: () => 'owner-1' } } as never, 'workspace-1'),
    ).rejects.toThrow('delete failed');
    expect(provisioning.afterWorkspaceDeleted).not.toHaveBeenCalled();
  });
});
