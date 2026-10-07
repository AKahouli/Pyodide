import { Injectable } from '@nestjs/common';
import { isObjectId, isUniqueViolation, normalizeObjectId } from '@common/postgres';
import { ClassifierFolderRepository } from '../persistence/classifier-folder.repository';
import { CreateFolderDto } from '../dto/create-folder.dto';
import { UpdateFolderDto } from '../dto/update-folder.dto';
import { MoveFolderDto } from '../dto/move-folder.dto';
import { IClassifierFolderResponse } from '../interfaces/classifier.interface';
import type { ClassifierFolderRecord, FolderCounts } from '../classifier.types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LoggerService } from '../../logger';
import { ClassifierAccessService } from './classifier-access.service';

@Injectable()
export class ClassifierFolderService {
  constructor(
    private readonly folders: ClassifierFolderRepository,
    private readonly access: ClassifierAccessService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ClassifierFolderService.name);
  }

  async listByWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<IClassifierFolderResponse[]> {
    await this.access.assertWorkspaceAccess(workspaceId, userId);

    const folders = await this.folders.listByWorkspace(workspaceId);
    if (folders.length === 0) return [];

    const counts = await this.folders.computeCounts(workspaceId, folders.map((f) => f.id));
    return folders.map((f) => this.toResponse(f, counts.get(f.id)));
  }

  async findById(userId: string, folderId: string): Promise<IClassifierFolderResponse> {
    const folder = await this.getOwnedFolder(userId, folderId);
    const counts = await this.folders.computeCounts(folder.workspaceId, [folder.id]);
    return this.toResponse(folder, counts.get(folder.id));
  }

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateFolderDto,
  ): Promise<IClassifierFolderResponse> {
    await this.access.assertWorkspaceAccess(workspaceId, userId);

    const parentId = dto.parentId ?? null;
    if (parentId) {
      await this.assertParentBelongsToWorkspace(parentId, workspaceId);
    }

    const name = dto.name.trim();
    const description = dto.description.trim();

    await this.assertNameUnique(workspaceId, parentId, name);

    const folder = await this.persisting(() =>
      this.folders.create({ workspaceId, parentId, name, description, createdBy: userId }),
    );

    this.logger.log('Classifier folder created', {
      folderId: folder.id,
      workspaceId,
      userId,
    });

    return this.toResponse(folder, { childCount: 0, fileCount: 0 });
  }

  async update(
    userId: string,
    folderId: string,
    dto: UpdateFolderDto,
  ): Promise<IClassifierFolderResponse> {
    let folder = await this.getOwnedFolder(userId, folderId);

    const patch: { name?: string; description?: string } = {};
    if (dto.name !== undefined) {
      const newName = dto.name.trim();
      if (newName !== folder.name) {
        await this.assertNameUnique(folder.workspaceId, folder.parentId, newName, folder.id);
        patch.name = newName;
      }
    }
    if (dto.description !== undefined) {
      patch.description = dto.description.trim();
    }

    if (Object.keys(patch).length > 0) {
      const updated = await this.persisting(() => this.folders.update(folder.id, patch));
      if (!updated) throw new NotFoundException(ErrorCode.CLASSIFIER_FOLDER_NOT_FOUND);
      folder = updated;
    }

    const counts = await this.folders.computeCounts(folder.workspaceId, [folder.id]);
    return this.toResponse(folder, counts.get(folder.id));
  }

  async move(
    userId: string,
    folderId: string,
    dto: MoveFolderDto,
  ): Promise<IClassifierFolderResponse> {
    let folder = await this.getOwnedFolder(userId, folderId);

    const newParentId = dto.parentId ? normalizeObjectId(dto.parentId) : null;
    if (newParentId === folder.parentId) {
      return this.findById(userId, folderId);
    }

    if (newParentId) {
      await this.assertParentBelongsToWorkspace(newParentId, folder.workspaceId);
      await this.assertNotDescendant(folder.id, newParentId);
    }

    await this.assertNameUnique(folder.workspaceId, newParentId, folder.name, folder.id);

    const moved = await this.persisting(() => this.folders.setParent(folder.id, newParentId));
    if (!moved) throw new NotFoundException(ErrorCode.CLASSIFIER_FOLDER_NOT_FOUND);
    folder = moved;

    this.logger.log('Classifier folder moved', {
      folderId: folder.id,
      newParentId,
      userId,
    });

    const counts = await this.folders.computeCounts(folder.workspaceId, [folder.id]);
    return this.toResponse(folder, counts.get(folder.id));
  }

  async delete(userId: string, folderId: string): Promise<void> {
    const folder = await this.getOwnedFolder(userId, folderId);

    // Sub-folders go with it and every file mapped to one of them becomes unassigned, atomically.
    const cascadedFolders = await this.folders.deleteWithDescendants(folder.id);

    this.logger.log('Classifier folder deleted', {
      folderId: folder.id,
      cascadedFolders,
      userId,
    });
  }

  // ───────── helpers ─────────

  /**
   * Loads a folder by id and verifies the current user can access the owning workspace.
   * Throws NOT_FOUND / FORBIDDEN as appropriate.
   */
  async getOwnedFolder(
    userId: string,
    folderId: string,
  ): Promise<ClassifierFolderRecord> {
    if (!isObjectId(folderId)) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_FOLDER_NOT_FOUND);
    }
    const folder = await this.folders.findById(folderId);
    if (!folder) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_FOLDER_NOT_FOUND);
    }
    try {
      await this.access.assertWorkspaceAccess(folder.workspaceId, userId);
    } catch (err) {
      // Translate workspace access errors into folder-scoped errors for clarity.
      if (err instanceof ForbiddenException) {
        throw new ForbiddenException(ErrorCode.CLASSIFIER_FOLDER_FORBIDDEN);
      }
      throw err;
    }
    return folder;
  }

  /** The database unique index closes the race the name pre-check leaves open. */
  private async persisting<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error, 'uq_classifier_folders_location')) {
        throw new ConflictException(ErrorCode.CLASSIFIER_FOLDER_NAME_EXISTS);
      }
      throw error;
    }
  }

  private async assertParentBelongsToWorkspace(parentId: string, workspaceId: string): Promise<void> {
    if (!isObjectId(parentId)) {
      throw new BadRequestException(ErrorCode.CLASSIFIER_FOLDER_INVALID_PARENT);
    }
    const parent = await this.folders.findById(parentId);
    if (!parent || parent.workspaceId !== normalizeObjectId(workspaceId)) {
      throw new BadRequestException(ErrorCode.CLASSIFIER_FOLDER_INVALID_PARENT);
    }
  }

  private async assertNameUnique(
    workspaceId: string,
    parentId: string | null,
    name: string,
    excludeFolderId?: string,
  ): Promise<void> {
    if (await this.folders.nameTaken(workspaceId, parentId, name, excludeFolderId)) {
      throw new ConflictException(ErrorCode.CLASSIFIER_FOLDER_NAME_EXISTS);
    }
  }

  private async assertNotDescendant(
    folderId: string,
    candidateParentId: string,
  ): Promise<void> {
    if (folderId === candidateParentId) {
      throw new ConflictException(ErrorCode.CLASSIFIER_FOLDER_CYCLE);
    }
    const descendants = await this.folders.descendantIds(folderId);
    if (descendants.includes(candidateParentId)) {
      throw new ConflictException(ErrorCode.CLASSIFIER_FOLDER_CYCLE);
    }
  }

  private toResponse(
    folder: ClassifierFolderRecord,
    counts: FolderCounts | undefined,
  ): IClassifierFolderResponse {
    return {
      id: folder.id,
      workspaceId: folder.workspaceId,
      parentId: folder.parentId,
      name: folder.name,
      description: folder.description,
      createdBy: folder.createdBy,
      childCount: counts?.childCount ?? 0,
      fileCount: counts?.fileCount ?? 0,
      createdAt: folder.createdAt.toISOString(),
      updatedAt: folder.updatedAt.toISOString(),
    };
  }
}
