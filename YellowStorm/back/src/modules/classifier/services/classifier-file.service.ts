import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WORKSPACE_DOCUMENT_READ_PORT,
  type WorkspaceDocumentReadPort,
  type WorkspaceDocumentRecord,
} from '../../workspace/ports';
import {
  ClassifierFolder,
  ClassifierFolderDocument,
} from '../schemas/classifier-folder.schema';
import {
  AssignmentSource,
  ClassifierFileAssignment,
  ClassifierFileAssignmentDocument,
} from '../schemas/classifier-file-assignment.schema';
import { AssignFileDto } from '../dto/assign-file.dto';
import { ListFilesQueryDto } from '../dto/list-files-query.dto';
import { IClassifierFileResponse } from '../interfaces/classifier.interface';
import {
  BadRequestException,
  NotFoundException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LoggerService } from '../../logger';
import { ClassifierAccessService } from './classifier-access.service';

@Injectable()
export class ClassifierFileService {
  constructor(
    @Inject(WORKSPACE_DOCUMENT_READ_PORT) private readonly documentReadPort: WorkspaceDocumentReadPort,
    @InjectModel(ClassifierFolder.name)
    private readonly folderModel: Model<ClassifierFolderDocument>,
    @InjectModel(ClassifierFileAssignment.name)
    private readonly assignmentModel: Model<ClassifierFileAssignmentDocument>,
    private readonly access: ClassifierAccessService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ClassifierFileService.name);
  }

  async listFiles(
    userId: string,
    workspaceId: string,
    query: ListFilesQueryDto,
  ): Promise<IClassifierFileResponse[]> {
    await this.access.assertWorkspaceAccess(workspaceId, userId);

    const documents = await this.documentReadPort.find(
      {
        workspaceId,
        isFolder: false,
        ...(query.search ? { originalNameSearch: query.search } : {}),
      },
      { sort: { field: 'createdAt', direction: 'desc' } },
    );

    if (documents.length === 0) return [];

    // TEMP diagnostic: surface the raw indexing status stored on each document.
    const statusCounts = documents.reduce<Record<string, number>>((acc, d) => {
      const s = (d as { indexingStatus?: string }).indexingStatus ?? 'undefined';
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.log('[indexing-status] listFiles statuses', {
      workspaceId,
      total: documents.length,
      counts: statusCounts,
      sample: documents.slice(0, 5).map((d) => ({
        name: (d as { originalName?: string; filename?: string }).originalName
          ?? (d as { filename?: string }).filename,
        indexingStatus: (d as { indexingStatus?: string }).indexingStatus ?? null,
        lastIndexedAt: (d as { lastIndexedAt?: Date }).lastIndexedAt ?? null,
      })),
    });

    const assignments = await this.assignmentModel
      .find({ workspaceId: new Types.ObjectId(workspaceId), documentId: { $in: documents.map((d) => new Types.ObjectId(d.id)) } })
      .lean()
      .exec();

    const assignmentByDoc = new Map(
      assignments.map((a) => [a.documentId.toString(), a]),
    );

    const wantsUnclassified = query.unclassified === 'true';
    const folderFilter = query.folderId ?? null;

    return documents
      .map((doc) => {
        const assignment = assignmentByDoc.get(doc.id);
        const folderId = assignment?.folderId ? assignment.folderId.toString() : null;
        return {
          doc,
          folderId,
          source: assignment?.assignmentSource ?? null,
        };
      })
      .filter((entry) => {
        if (wantsUnclassified) return entry.folderId === null;
        if (folderFilter) return entry.folderId === folderFilter;
        return true;
      })
      .map(({ doc, folderId, source }) => this.toResponse(doc, folderId, source));
  }

  async assignToFolder(
    userId: string,
    workspaceId: string,
    documentId: string,
    dto: AssignFileDto,
  ): Promise<IClassifierFileResponse> {
    await this.access.assertWorkspaceAccess(workspaceId, userId);

    if (!Types.ObjectId.isValid(documentId)) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_FILE_NOT_FOUND);
    }

    const document = await this.documentReadPort.findById(documentId);
    if (
      !document ||
      document.workspaceId !== workspaceId ||
      document.isFolder
    ) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_FILE_NOT_FOUND);
    }

    const folderId = dto.folderId ?? null;
    if (folderId) {
      await this.assertFolderBelongsToWorkspace(folderId, workspaceId);
    }

    const wsObjectId = new Types.ObjectId(workspaceId);
    const docObjectId = new Types.ObjectId(documentId);

    const updated = await this.assignmentModel
      .findOneAndUpdate(
        { workspaceId: wsObjectId, documentId: docObjectId },
        {
          $set: {
            folderId: folderId ? new Types.ObjectId(folderId) : null,
            assignmentSource: AssignmentSource.MANUAL,
            assignedBy: new Types.ObjectId(userId),
            classificationRunId: null,
          },
          $setOnInsert: {
            workspaceId: wsObjectId,
            documentId: docObjectId,
          },
        },
        { upsert: true, new: true, lean: true },
      )
      .exec();

    this.logger.log('File assignment updated', {
      workspaceId,
      documentId,
      folderId,
      userId,
    });

    return this.toResponse(
      document,
      updated?.folderId ? updated.folderId.toString() : null,
      updated?.assignmentSource ?? AssignmentSource.MANUAL,
    );
  }

  /**
   * Bulk-apply classification results emitted by a playbook run.
   * Skips files that already have a folder unless `overwrite` is true.
   * Returns how many files were actually re-assigned.
   */
  async applyClassificationResults(params: {
    workspaceId: string;
    runId: string;
    triggeredBy: string;
    overwrite: boolean;
    mapping: Array<{ documentId: string; folderId: string }>;
  }): Promise<number> {
    const wsObjectId = new Types.ObjectId(params.workspaceId);
    const runObjectId = new Types.ObjectId(params.runId);
    const userObjectId = new Types.ObjectId(params.triggeredBy);

    let updated = 0;
    for (const entry of params.mapping) {
      if (!Types.ObjectId.isValid(entry.documentId) || !Types.ObjectId.isValid(entry.folderId)) {
        continue;
      }
      const docObjectId = new Types.ObjectId(entry.documentId);
      const folderObjectId = new Types.ObjectId(entry.folderId);

      const filter: Record<string, unknown> = {
        workspaceId: wsObjectId,
        documentId: docObjectId,
      };
      if (!params.overwrite) {
        filter.folderId = null;
      }

      const result = await this.assignmentModel
        .updateOne(
          filter,
          {
            $set: {
              folderId: folderObjectId,
              assignmentSource: AssignmentSource.PLAYBOOK,
              assignedBy: userObjectId,
              classificationRunId: runObjectId,
            },
            $setOnInsert: {
              workspaceId: wsObjectId,
              documentId: docObjectId,
            },
          },
          { upsert: !params.overwrite ? false : true },
        )
        .exec();

      if (result.modifiedCount > 0 || result.upsertedCount > 0) {
        updated += 1;
      }
    }
    return updated;
  }

  // ───────── helpers ─────────

  private async assertFolderBelongsToWorkspace(
    folderId: string,
    workspaceId: string,
  ): Promise<void> {
    const folder = await this.folderModel
      .findById(folderId)
      .select({ workspaceId: 1 })
      .lean()
      .exec();
    if (!folder || folder.workspaceId.toString() !== workspaceId) {
      throw new BadRequestException(ErrorCode.CLASSIFIER_FOLDER_NOT_FOUND);
    }
  }

  private toResponse(
    doc: WorkspaceDocumentRecord,
    folderId: string | null,
    source: AssignmentSource | null,
  ): IClassifierFileResponse {
    return {
      id: doc.id,
      workspaceId: doc.workspaceId,
      name: doc.originalName ?? doc.filename ?? '',
      mimeType: doc.mimeType ?? 'application/octet-stream',
      size: doc.size ?? 0,
      uploadedAt: doc.uploadedAt instanceof Date
        ? doc.uploadedAt.toISOString()
        : (doc.uploadedAt as unknown as string | null) ?? null,
      folderId,
      assignmentSource: source,
      path: doc.path,
      indexingStatus: (doc.indexingStatus ?? 'none') as IClassifierFileResponse['indexingStatus'],
      indexingError: doc.indexingError,
      lastIndexedAt: doc.lastIndexedAt instanceof Date
        ? doc.lastIndexedAt.toISOString()
        : (doc.lastIndexedAt as string | undefined) ?? undefined,
      type: (doc.type as 'doc' | 'url') ?? 'doc',
      sourceUrl: doc.sourceUrl,
      sourceRootUrl: doc.metadata?.sourceRootUrl,
      normalizedSourceRootUrl: doc.metadata?.normalizedSourceRootUrl,
      sourceGroupId: doc.metadata?.sourceGroupId,
      status: (doc.status as IClassifierFileResponse['status']) ?? 'completed',
    };
  }
}
