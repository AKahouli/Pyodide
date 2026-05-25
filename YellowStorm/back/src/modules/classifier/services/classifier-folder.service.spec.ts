import { Types } from 'mongoose';
import { ClassifierFolderService } from './classifier-folder.service';
import { ConflictException, ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

const buildLogger = () => ({
  setContext: jest.fn(),
  log: jest.fn(),
  error: jest.fn(),
});

describe('ClassifierFolderService', () => {
  const workspaceId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  describe('create', () => {
    it('persists a folder when the user has workspace access', async () => {
      const folderModel = {
        findOne: jest.fn().mockReturnValue({
          select: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
        }),
        create: jest.fn().mockImplementation((doc) =>
          Promise.resolve({
            ...doc,
            _id: new Types.ObjectId(),
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
      };
      const assignmentModel = {};
      const access = { assertWorkspaceAccess: jest.fn().mockResolvedValue(undefined) };

      const service = new ClassifierFolderService(
        folderModel as never,
        assignmentModel as never,
        access as never,
        buildLogger() as never,
      );

      const result = await service.create(userId.toString(), workspaceId.toString(), {
        name: 'Contracts',
        description: 'All signed contracts',
      });

      expect(access.assertWorkspaceAccess).toHaveBeenCalledWith(
        workspaceId.toString(),
        userId.toString(),
      );
      expect(folderModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: expect.any(Types.ObjectId),
          parentId: null,
          name: 'Contracts',
          description: 'All signed contracts',
          createdBy: expect.any(Types.ObjectId),
        }),
      );
      expect(result.name).toBe('Contracts');
      expect(result.childCount).toBe(0);
      expect(result.fileCount).toBe(0);
    });

    it('throws ForbiddenException when the workspace is not accessible', async () => {
      const folderModel = {};
      const assignmentModel = {};
      const access = {
        assertWorkspaceAccess: jest
          .fn()
          .mockRejectedValue(new ForbiddenException(ErrorCode.WORKSPACE_FORBIDDEN)),
      };

      const service = new ClassifierFolderService(
        folderModel as never,
        assignmentModel as never,
        access as never,
        buildLogger() as never,
      );

      await expect(
        service.create(userId.toString(), workspaceId.toString(), {
          name: 'Will fail',
          description: 'No access',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects creation when name already exists at the same location', async () => {
      const folderModel = {
        findOne: jest.fn().mockReturnValue({
          select: () => ({
            lean: () => ({
              exec: () => Promise.resolve({ _id: new Types.ObjectId() }),
            }),
          }),
        }),
        create: jest.fn(),
      };
      const access = { assertWorkspaceAccess: jest.fn().mockResolvedValue(undefined) };

      const service = new ClassifierFolderService(
        folderModel as never,
        {} as never,
        access as never,
        buildLogger() as never,
      );

      await expect(
        service.create(userId.toString(), workspaceId.toString(), {
          name: 'Duplicate',
          description: 'Conflict',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(folderModel.create).not.toHaveBeenCalled();
    });
  });

});
