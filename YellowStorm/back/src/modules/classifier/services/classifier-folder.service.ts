import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ClassifierFolder,
  ClassifierFolderDocument,
} from '../schemas/classifier-folder.schema';
import {
  ClassifierFileAssignment,
  ClassifierFileAssignmentDocument,
} from '../schemas/classifier-file-assignment.schema';
import { CreateFolderDto } from '../dto/create-folder.dto';
import { UpdateFolderDto } from '../dto/update-folder.dto';
import { MoveFolderDto } from '../dto/move-folder.dto';
import { IClassifierFolderResponse } from '../interfaces/classifier.interface';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LoggerService } from '../../logger';
import { ClassifierAccessService } from './classifier-access.service';

interface FolderCounts {
  childCount: number;
  fileCount: number;
}

@Injectable()
export class ClassifierFolderService {
  constructor(
    @InjectModel(ClassifierFolder.name)
    private readonly folderModel: Model<ClassifierFolderDocument>,
    @InjectModel(ClassifierFileAssignment.name)
    private readonly assignmentModel: Model<ClassifierFileAssignmentDocument>,
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

    const folders = await this.folderModel
      .find({ workspaceId: new Types.ObjectId(workspaceId) })
      .sort({ name: 1 })
      .lean()
      .exec();

    if (folders.length === 0) return [];

    const counts = await this.computeCounts(workspaceId, folders.map((f) => f._id));
    return folders.map((f) => this.toResponse(f, counts.get(f._id.toString())));
  }

  async findById(userId: string, folderId: string): Promise<IClassifierFolderResponse> {
    const folder = await this.getOwnedFolder(userId, folderId);
    const counts = await this.computeCounts(folder.workspaceId.toString(), [folder._id]);
    return this.toResponse(folder, counts.get(folder._id.toString()));
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

    const folder = await this.folderModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      parentId: parentId ? new Types.ObjectId(parentId) : null,
      name,
      description,
      createdBy: new Types.ObjectId(userId),
    });

    this.logger.log('Classifier folder created', {
      folderId: folder._id.toString(),
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
    const folder = await this.getOwnedFolder(userId, folderId);

    if (dto.name !== undefined) {
      const newName = dto.name.trim();
      if (newName !== folder.name) {
        await this.assertNameUnique(
          folder.workspaceId.toString(),
          folder.parentId ? folder.parentId.toString() : null,
          newName,
          folder._id.toString(),
        );
        folder.name = newName;
      }
    }

    if (dto.description !== undefined) {
      folder.description = dto.description.trim();
    }

    await folder.save();

    const counts = await this.computeCounts(folder.workspaceId.toString(), [folder._id]);
    return this.toResponse(folder, counts.get(folder._id.toString()));
  }

  async move(
    userId: string,
    folderId: string,
    dto: MoveFolderDto,
  ): Promise<IClassifierFolderResponse> {
    const folder = await this.getOwnedFolder(userId, folderId);

    const newParentId = dto.parentId ?? null;
    const currentParentId = folder.parentId ? folder.parentId.toString() : null;
    if (newParentId === currentParentId) {
      return this.findById(userId, folderId);
    }

    if (newParentId) {
      await this.assertParentBelongsToWorkspace(newParentId, folder.workspaceId.toString());
      await this.assertNotDescendant(folder._id.toString(), newParentId);
    }

    await this.assertNameUnique(
      folder.workspaceId.toString(),
      newParentId,
      folder.name,
      folder._id.toString(),
    );

    folder.parentId = newParentId ? new Types.ObjectId(newParentId) : null;
    await folder.save();

    this.logger.log('Classifier folder moved', {
      folderId: folder._id.toString(),
      newParentId,
      userId,
    });

    const counts = await this.computeCounts(folder.workspaceId.toString(), [folder._id]);
    return this.toResponse(folder, counts.get(folder._id.toString()));
  }

  async delete(userId: string, folderId: string): Promise<void> {
    const folder = await this.getOwnedFolder(userId, folderId);

    const descendants = await this.collectDescendantIds(folder._id);
    const allIds = [folder._id, ...descendants];

    // Unassign every file that was mapped to one of the removed folders.
    await this.assignmentModel.updateMany(
      { folderId: { $in: allIds } },
      { $set: { folderId: null, assignmentSource: 'manual' } },
    );

    await this.folderModel.deleteMany({ _id: { $in: allIds } });

    this.logger.log('Classifier folder deleted', {
      folderId: folder._id.toString(),
      cascadedFolders: descendants.length,
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
  ): Promise<ClassifierFolderDocument> {
    if (!Types.ObjectId.isValid(folderId)) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_FOLDER_NOT_FOUND);
    }
    const folder = await this.folderModel.findById(folderId).exec();
    if (!folder) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_FOLDER_NOT_FOUND);
    }
    try {
      await this.access.assertWorkspaceAccess(folder.workspaceId.toString(), userId);
    } catch (err) {
      // Translate workspace access errors into folder-scoped errors for clarity.
      if (err instanceof ForbiddenException) {
        throw new ForbiddenException(ErrorCode.CLASSIFIER_FOLDER_FORBIDDEN);
      }
      throw err;
    }
    return folder;
  }

  private async assertParentBelongsToWorkspace(parentId: string, workspaceId: string): Promise<void> {
    if (!Types.ObjectId.isValid(parentId)) {
      throw new BadRequestException(ErrorCode.CLASSIFIER_FOLDER_INVALID_PARENT);
    }
    const parent = await this.folderModel
      .findById(parentId)
      .select({ workspaceId: 1 })
      .lean()
      .exec();
    if (!parent || parent.workspaceId.toString() !== workspaceId) {
      throw new BadRequestException(ErrorCode.CLASSIFIER_FOLDER_INVALID_PARENT);
    }
  }

  private async assertNameUnique(
    workspaceId: string,
    parentId: string | null,
    name: string,
    excludeFolderId?: string,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      parentId: parentId ? new Types.ObjectId(parentId) : null,
      name,
    };
    if (excludeFolderId) {
      filter._id = { $ne: new Types.ObjectId(excludeFolderId) };
    }
    const duplicate = await this.folderModel.findOne(filter).select({ _id: 1 }).lean().exec();
    if (duplicate) {
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
    const descendants = await this.collectDescendantIds(new Types.ObjectId(folderId));
    if (descendants.some((id) => id.toString() === candidateParentId)) {
      throw new ConflictException(ErrorCode.CLASSIFIER_FOLDER_CYCLE);
    }
  }

  private async collectDescendantIds(rootId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const collected: Types.ObjectId[] = [];
    let frontier: Types.ObjectId[] = [rootId];
    // Breadth-first walk; bounded by workspace folder depth (small in practice).
    while (frontier.length > 0) {
      const children = await this.folderModel
        .find({ parentId: { $in: frontier } })
        .select({ _id: 1 })
        .lean()
        .exec();
      if (children.length === 0) break;
      const ids = children.map((c) => c._id);
      collected.push(...ids);
      frontier = ids;
    }
    return collected;
  }

  private async computeCounts(
    workspaceId: string,
    folderIds: Types.ObjectId[],
  ): Promise<Map<string, FolderCounts>> {
    const result = new Map<string, FolderCounts>();
    folderIds.forEach((id) => result.set(id.toString(), { childCount: 0, fileCount: 0 }));

    const wsObjectId = new Types.ObjectId(workspaceId);

    const [childCounts, fileCounts] = await Promise.all([
      this.folderModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            workspaceId: wsObjectId,
            parentId: { $in: folderIds },
          },
        },
        { $group: { _id: '$parentId', count: { $sum: 1 } } },
      ]),
      this.assignmentModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            workspaceId: wsObjectId,
            folderId: { $in: folderIds },
          },
        },
        { $group: { _id: '$folderId', count: { $sum: 1 } } },
      ]),
    ]);

    childCounts.forEach((c) => {
      const entry = result.get(c._id.toString());
      if (entry) entry.childCount = c.count;
    });
    fileCounts.forEach((c) => {
      const entry = result.get(c._id.toString());
      if (entry) entry.fileCount = c.count;
    });

    return result;
  }

  private toResponse(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
    counts: FolderCounts | undefined,
  ): IClassifierFolderResponse {
    return {
      id: (doc._id as { toString(): string }).toString(),
      workspaceId: (doc.workspaceId as { toString(): string }).toString(),
      parentId: doc.parentId ? (doc.parentId as { toString(): string }).toString() : null,
      name: doc.name as string,
      description: doc.description as string,
      createdBy: (doc.createdBy as { toString(): string }).toString(),
      childCount: counts?.childCount ?? 0,
      fileCount: counts?.fileCount ?? 0,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    };
  }
}
