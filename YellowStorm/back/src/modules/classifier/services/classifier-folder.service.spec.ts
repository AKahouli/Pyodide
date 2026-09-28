import { newObjectId } from '@common/postgres';
import { ClassifierFolderService } from './classifier-folder.service';
import type { ClassifierFolderRecord } from '../classifier.types';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

const buildLogger = () => ({
  setContext: jest.fn(),
  log: jest.fn(),
  error: jest.fn(),
});

const folder = (over: Partial<ClassifierFolderRecord> = {}): ClassifierFolderRecord => ({
  id: newObjectId(),
  workspaceId: newObjectId(),
  parentId: null,
  name: 'Contracts',
  description: 'All signed contracts',
  createdBy: newObjectId(),
  createdAt: new Date('2026-09-01T10:00:00Z'),
  updatedAt: new Date('2026-09-01T10:00:00Z'),
  ...over,
});

function makeService(repo: Record<string, jest.Mock> = {}, access: Record<string, jest.Mock> = {}) {
  const folders = {
    findById: jest.fn(),
    nameTaken: jest.fn().mockResolvedValue(false),
    create: jest.fn(),
    update: jest.fn(),
    setParent: jest.fn(),
    descendantIds: jest.fn().mockResolvedValue([]),
    deleteWithDescendants: jest.fn().mockResolvedValue(0),
    computeCounts: jest.fn().mockResolvedValue(new Map()),
    listByWorkspace: jest.fn().mockResolvedValue([]),
    ...repo,
  };
  const accessService = { assertWorkspaceAccess: jest.fn().mockResolvedValue(undefined), ...access };
  const logger = buildLogger();
  const service = new ClassifierFolderService(folders as never, accessService as never, logger as never);
  return { service, folders, access: accessService, logger };
}

describe('ClassifierFolderService', () => {
  const workspaceId = newObjectId();
  const userId = newObjectId();

  describe('create', () => {
    it('persists a folder when the user has workspace access', async () => {
      const { service, folders, access } = makeService();
      folders.create.mockImplementation(async (input) => folder({ ...input }));

      const result = await service.create(userId, workspaceId, {
        name: '  Contracts ',
        description: 'All signed contracts',
      });

      expect(access.assertWorkspaceAccess).toHaveBeenCalledWith(workspaceId, userId);
      expect(folders.create).toHaveBeenCalledWith({
        workspaceId,
        parentId: null,
        name: 'Contracts',
        description: 'All signed contracts',
        createdBy: userId,
      });
      expect(result.name).toBe('Contracts');
      expect(result.childCount).toBe(0);
      expect(result.fileCount).toBe(0);
    });

    it('throws ForbiddenException when the workspace is not accessible', async () => {
      const { service, folders } = makeService(
        {},
        { assertWorkspaceAccess: jest.fn().mockRejectedValue(new ForbiddenException(ErrorCode.WORKSPACE_FORBIDDEN)) },
      );

      await expect(
        service.create(userId, workspaceId, { name: 'Will fail', description: 'No access' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(folders.create).not.toHaveBeenCalled();
    });

    it('rejects creation when name already exists at the same location', async () => {
      const { service, folders } = makeService({ nameTaken: jest.fn().mockResolvedValue(true) });

      await expect(
        service.create(userId, workspaceId, { name: 'Duplicate', description: 'Conflict' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(folders.create).not.toHaveBeenCalled();
    });

    it('maps the unique index violation of a concurrent creation to a conflict', async () => {
      const { service } = makeService({
        create: jest.fn().mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_classifier_folders_location' })),
      });

      await expect(
        service.create(userId, workspaceId, { name: 'Race', description: 'Two requests at once' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a parent that belongs to another workspace', async () => {
      const parent = folder({ workspaceId: newObjectId() });
      const { service, folders } = makeService({ findById: jest.fn().mockResolvedValue(parent) });

      await expect(
        service.create(userId, workspaceId, { name: 'Child', description: 'Wrong tree', parentId: parent.id }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(folders.create).not.toHaveBeenCalled();
    });
  });

  describe('move', () => {
    it('refuses to move a folder below one of its own descendants', async () => {
      const root = folder({ workspaceId });
      const child = folder({ workspaceId, parentId: root.id });
      const { service, folders } = makeService({
        findById: jest.fn().mockImplementation(async (id: string) => (id === root.id ? root : id === child.id ? child : null)),
        descendantIds: jest.fn().mockResolvedValue([child.id]),
      });

      await expect(service.move(userId, root.id, { parentId: child.id })).rejects.toBeInstanceOf(ConflictException);
      expect(folders.setParent).not.toHaveBeenCalled();
    });

    it('is a no-op when the parent does not change', async () => {
      const root = folder({ workspaceId });
      const { service, folders } = makeService({ findById: jest.fn().mockResolvedValue(root) });

      const result = await service.move(userId, root.id, { parentId: null });

      expect(result.id).toBe(root.id);
      expect(folders.setParent).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('does not write when nothing changed', async () => {
      const existing = folder({ workspaceId });
      const { service, folders } = makeService({ findById: jest.fn().mockResolvedValue(existing) });

      const result = await service.update(userId, existing.id, { name: existing.name });

      expect(folders.update).not.toHaveBeenCalled();
      expect(result.name).toBe(existing.name);
    });
  });

  describe('delete', () => {
    it('deletes the folder together with its sub-folders through the repository', async () => {
      const existing = folder({ workspaceId });
      const { service, folders, logger } = makeService({
        findById: jest.fn().mockResolvedValue(existing),
        deleteWithDescendants: jest.fn().mockResolvedValue(3),
      });

      await service.delete(userId, existing.id);

      expect(folders.deleteWithDescendants).toHaveBeenCalledWith(existing.id);
      expect(logger.log).toHaveBeenCalledWith('Classifier folder deleted', expect.objectContaining({ cascadedFolders: 3 }));
    });
  });

  describe('getOwnedFolder', () => {
    it('answers not found for an id that is not an object id', async () => {
      const { service, folders } = makeService();

      await expect(service.getOwnedFolder(userId, 'not-an-id')).rejects.toBeInstanceOf(NotFoundException);
      expect(folders.findById).not.toHaveBeenCalled();
    });

    it('translates a workspace access error into a folder-scoped one', async () => {
      const existing = folder();
      const { service } = makeService(
        { findById: jest.fn().mockResolvedValue(existing) },
        { assertWorkspaceAccess: jest.fn().mockRejectedValue(new ForbiddenException(ErrorCode.WORKSPACE_FORBIDDEN)) },
      );

      await expect(service.getOwnedFolder(userId, existing.id)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
