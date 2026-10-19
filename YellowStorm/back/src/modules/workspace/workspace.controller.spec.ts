import { Reflector } from '@nestjs/core';
import { Permissions } from '../authorization/constants/permissions';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { validate } from 'class-validator';
import { UpdateWorkspaceStorageDto } from '../system/dto/update-workspace-upload-settings.dto';
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

describe('Workspace admin storage boundary', () => {
  it.each(['getAdminStorage', 'updateAdminStorage'] as const)('requires WORKSPACES_ALL for %s', (method) => {
    const handler = WorkspaceController.prototype[method];
    expect(Reflect.getMetadata('permissions', handler)).toEqual([Permissions.WORKSPACES_ALL]);
    expect(Reflect.getMetadata('__guards__', handler)).toContain(PermissionsGuard);
  });

  it.each([0, -1, 1.5, 1048577])('rejects invalid quota %s', async (allocatedStorageMb) => {
    const dto = Object.assign(new UpdateWorkspaceStorageDto(), { allocatedStorageMb, expectedAllocatedStorage: 52428800 });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('requires an expected byte quota for optimistic concurrency', async () => {
    expect((await validate(Object.assign(new UpdateWorkspaceStorageDto(), { allocatedStorageMb: 200 }))).length).toBeGreaterThan(0);
  });
});

describe('Workspace quota permission enforcement', () => {
  it.each([undefined, { permissions: [] }, { permissions: ['workspaces.read'] }])('rejects actors without workspace administration', (user) => {
    const guard = new PermissionsGuard(new Reflector());
    const context = { getHandler: () => WorkspaceController.prototype.updateAdminStorage, getClass: () => WorkspaceController, switchToHttp: () => ({ getRequest: () => ({ user }) }) };
    expect(() => guard.canActivate(context as never)).toThrow();
  });
  it('allows an administrator', () => {
    const guard = new PermissionsGuard(new Reflector());
    const context = { getHandler: () => WorkspaceController.prototype.updateAdminStorage, getClass: () => WorkspaceController, switchToHttp: () => ({ getRequest: () => ({ user: { permissions: [Permissions.WORKSPACES_ALL] } }) }) };
    expect(guard.canActivate(context as never)).toBe(true);
  });
});
