import { Injectable } from '@nestjs/common';
import { isObjectId, normalizeObjectId } from '@common/postgres';
import { 
  type WorkspaceDocumentRecord,  
} from '../../workspace/ports';
import { ClassifierAssignmentRepository } from '../persistence/classifier-assignment.repository';
import { ClassifierFolderRepository } from '../persistence/classifier-folder.repository';
import { AssignmentSource } from '../classifier.types';
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
import { PgWorkspaceDocumentReadAdapter } from '../../workspace/persistence/postgres/pg-workspace-document-read.adapter';

@Injectable()
export class ClassifierFileService {
  constructor(
    private readonly documentReadPort: PgWorkspaceDocumentReadAdapter,
    private readonly folders: ClassifierFolderRepository,
    private readonly assignments: ClassifierAssignmentRepository,
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

    const assignmentByDoc = new Map(
      (await this.assignments.listByWorkspace(workspaceId)).map((a) => [a.documentId, a]),
    );

    const wantsUnclassified = query.unclassified === 'true';
    const folderFilter = query.folderId ?? null;

    return documents
      .map((doc) => {
        const assignment = assignmentByDoc.get(doc.id);
        return {
          doc,
          folderId: assignment?.folderId ?? null,
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

    if (!isObjectId(documentId)) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_FILE_NOT_FOUND);
    }

    const document = await this.documentReadPort.findById(documentId);
    if (
      !document ||
      document.workspaceId !== normalizeObjectId(workspaceId) ||
      document.isFolder
    ) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_FILE_NOT_FOUND);
    }

    const folderId = dto.folderId ? normalizeObjectId(dto.folderId) : null;
    if (folderId) {
      await this.assertFolderBelongsToWorkspace(folderId, workspaceId);
    }

    const updated = await this.assignments.upsertManual({ workspaceId, documentId, folderId, assignedBy: userId });

    this.logger.log('File assignment updated', {
      workspaceId,
      documentId,
      folderId,
      userId,
    });

    return this.toResponse(document, updated.folderId, updated.assignmentSource);
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
    mapping: { documentId: string; folderId: string }[];
  }): Promise<number> {
    let updated = 0;
    for (const entry of params.mapping) {
      if (!isObjectId(entry.documentId) || !isObjectId(entry.folderId)) {
        continue;
      }
      const changed = await this.assignments.applyPlaybookResult({
        workspaceId: params.workspaceId,
        documentId: entry.documentId,
        folderId: entry.folderId,
        runId: params.runId,
        assignedBy: params.triggeredBy,
        overwrite: params.overwrite,
      });
      if (changed) {
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
    const folder = await this.folders.findById(folderId);
    if (!folder || folder.workspaceId !== normalizeObjectId(workspaceId)) {
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
        : (doc.lastIndexedAt) ?? undefined,
      type: (doc.type as 'doc' | 'url') ?? 'doc',
      sourceUrl: doc.sourceUrl,
      sourceRootUrl: doc.metadata?.sourceRootUrl,
      normalizedSourceRootUrl: doc.metadata?.normalizedSourceRootUrl,
      sourceGroupId: doc.metadata?.sourceGroupId,
      status: (doc.status as IClassifierFileResponse['status']) ?? 'completed',
    };
  }
}
