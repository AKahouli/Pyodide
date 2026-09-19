import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkspaceDoc,
  WorkspaceDocumentDoc,
  DocumentStatus,
  IndexingStatus,
} from '../schemas/workspace-document.schema';
import {
  UploadSession,
  UploadSessionDocument,
} from '../schemas/upload-session.schema';
import {
  DocumentResponse,
  BulkDeleteResult,
} from '../interfaces/workspace-document.interface';
import { WorkspaceService } from '../workspace.service';
import { DocumentService } from '../../document/document.service';
import { LoggerService } from '../../logger';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { IndexingService } from '../../indexing/indexing.service';
import { WorkspaceArtifactCleanupService } from '../services/workspace-artifact-cleanup.service';
import { WorkspaceIntegrationEvents } from '../../integration-events/contracts';
import { WorkspaceDocumentSupport } from './document-support';

@Injectable()
export class WorkspaceDocumentTree {
  constructor(
    @InjectModel(WorkspaceDoc.name)
    private readonly documentModel: Model<WorkspaceDocumentDoc>,
    @InjectModel(UploadSession.name)
    private readonly uploadSessionModel: Model<UploadSessionDocument>,
    private readonly workspaceService: WorkspaceService,
    private readonly documentService: DocumentService,
    @Inject(forwardRef(() => IndexingService))
    private readonly indexingService: IndexingService,
    private readonly workspaceArtifacts: WorkspaceArtifactCleanupService,
    private readonly support: WorkspaceDocumentSupport,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkspaceDocumentTree');
  }

  /**
   * Create a folder in a workspace
   */
  async createFolder(
    workspaceId: string,
    userId: string,
    name: string,
    parentId?: string,
  ): Promise<DocumentResponse> {
    // Validate folder name
    const sanitizedName = this.support.sanitizeFilename(name);
    if (!sanitizedName) {
      throw new BadRequestException('Folder name cannot be empty');
    }

    // Check for duplicate folder name in same parent
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      isFolder: true,
      folderName: sanitizedName,
    };

    if (parentId) {
      query.parentId = new Types.ObjectId(parentId);
    } else {
      query.parentId = null;
    }

    const existing = await this.documentModel.findOne(query);
    if (existing) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'A folder with this name already exists in this location',
      );
    }

    // Create folder record
    const folderId = new Types.ObjectId();
    const folderPath = `folder:${folderId}`; // Unique path for folders

    const folder = await this.documentModel.create({
      _id: folderId,
      filename: '', // Folders don't have files
      originalName: sanitizedName,
      mimeType: 'folder',
      size: 0,
      path: folderPath, // Unique path for folders to avoid duplicate key error
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.COMPLETED,
      isFolder: true,
      folderName: sanitizedName,
      parentId: parentId ? new Types.ObjectId(parentId) : null,
    });

    this.logger.log('Folder created', {
      folderId: folder._id,
      workspaceId,
      name: sanitizedName,
      parentId,
    });

    return this.support.mapToResponse(folder);
  }

  /**
   * Rename a folder
   */
  async renameFolder(
    folderId: string,
    newName: string,
    userId: string,
  ): Promise<DocumentResponse> {
    const folder = await this.documentModel.findById(folderId);

    if (!folder) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Folder not found',
      );
    }

    if (!folder.isFolder) {
      throw new BadRequestException('Document is not a folder');
    }

    // Check permission - only creator can rename
    if (folder.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have permission to rename this folder',
      );
    }

    // Validate new name
    const sanitizedName = this.support.sanitizeFilename(newName);
    if (!sanitizedName) {
      throw new BadRequestException('Folder name cannot be empty');
    }

    // Check for duplicate folder name in same parent
    const query: Record<string, unknown> = {
      workspaceId: folder.workspaceId,
      createdBy: folder.createdBy,
      isFolder: true,
      folderName: sanitizedName,
      parentId: folder.parentId,
      _id: { $ne: folderId },
    };

    const existing = await this.documentModel.findOne(query);
    if (existing) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'A folder with this name already exists in this location',
      );
    }

    folder.folderName = sanitizedName;
    folder.originalName = sanitizedName;
    await folder.save();

    this.logger.log('Folder renamed', {
      folderId: folder._id,
      userId,
      oldName: folder.originalName,
      newName: sanitizedName,
    });

    return this.support.mapToResponse(folder);
  }

  /**
   * Delete a folder and all its contents recursively
   */
  async deleteFolder(
    workspaceId: string,
    userId: string,
    folderId: string,
  ): Promise<{ deletedFolders: number; deletedDocuments: number }> {
    const folder = await this.documentModel.findOne({
      _id: folderId,
      workspaceId: new Types.ObjectId(workspaceId),
    });

    if (!folder) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Folder not found',
      );
    }

    if (!folder.isFolder) {
      throw new BadRequestException('Document is not a folder');
    }

    if (folder.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this folder',
      );
    }

    const descendantDocumentIds = await this.collectFolderDocumentIds(
      new Types.ObjectId(folderId),
      workspaceId,
    );
    for (const documentId of descendantDocumentIds) {
      const linkedArtifactCount = await this.workspaceArtifacts.countBySource(
        workspaceId,
        documentId,
      );
      if (linkedArtifactCount > 0) {
        throw new ConflictException(
          ErrorCode.WORKSPACE_DOCUMENT_HAS_DERIVED_ARTIFACTS,
          'Delete linked decision flows before deleting this folder',
        );
      }
    }

    // Recursively delete all contents
    const result = await this.deleteFolderRecursive(new Types.ObjectId(folderId), workspaceId, userId);

    // Delete the folder itself
    await this.documentModel.deleteOne({
      _id: folderId,
      workspaceId: new Types.ObjectId(workspaceId),
    });

    this.logger.log('Folder deleted', {
      folderId,
      workspaceId,
      deletedFolders: result.deletedFolders + 1,
      deletedDocuments: result.deletedDocuments,
    });

    return {
      deletedFolders: result.deletedFolders + 1,
      deletedDocuments: result.deletedDocuments,
    };
  }

  /**
   * Recursively delete folder contents
   */
  private async deleteFolderRecursive(
    folderId: Types.ObjectId,
    workspaceId: string,
    userId: string,
  ): Promise<{ deletedFolders: number; deletedDocuments: number }> {
    // Find all items in the folder
    const items = await this.documentModel.find({
      parentId: folderId,
      workspaceId: new Types.ObjectId(workspaceId),
    });

    let deletedFolders = 0;
    let deletedDocuments = 0;

    for (const item of items) {
      if (item.isFolder) {
        // Recursively delete subfolder
        const subResult = await this.deleteFolderRecursive(
          item._id,
          workspaceId,
          userId,
        );
        deletedFolders += subResult.deletedFolders + 1;
        deletedDocuments += subResult.deletedDocuments;
      } else {
        // Delete document file from storage (skip for folders)
        try {
          if (!item.isFolder && item.path) {
            await this.documentService.delete(item.path);
          }
        } catch (error) {
          this.logger.warn('Failed to delete blob', {
            documentId: item._id,
            path: item.path,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        // Delete document index
        if (item.indexingStatus === IndexingStatus.READY) {
          this.indexingService.deleteDocumentIndex(item._id.toString(), workspaceId).catch((err) => {
            this.logger.warn('Failed to delete document index', {
              documentId: item._id,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          });
        }

        await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentDeletedV1, item);

        deletedDocuments++;
      }

      // Delete item record
      await this.documentModel.deleteOne({ _id: item._id });
    }

    return { deletedFolders, deletedDocuments };
  }

  private async collectFolderDocumentIds(folderId: Types.ObjectId, workspaceId: string): Promise<string[]> {
    const items = await this.documentModel.find({ parentId: folderId, workspaceId: new Types.ObjectId(workspaceId) });
    const ids: string[] = [];
    for (const item of items) {
      if (item.isFolder) ids.push(...await this.collectFolderDocumentIds(item._id, workspaceId));
      else ids.push(item._id.toString());
    }
    return ids;
  }

  /**
   * Delete a single document
   */
  async delete(
    workspaceId: string,
    userId: string,
    documentId: string,
    cascadeArtifacts = false,
  ): Promise<void> {
    const document = await this.documentModel.findOne({
      _id: documentId,
      workspaceId: new Types.ObjectId(workspaceId),
    });

    if (!document) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    const linkedArtifactCount = await this.workspaceArtifacts.countBySource(
      workspaceId,
      documentId,
    );
    if (linkedArtifactCount > 0 && !cascadeArtifacts) {
      throw new ConflictException(
        ErrorCode.WORKSPACE_DOCUMENT_HAS_DERIVED_ARTIFACTS,
        `This document has ${linkedArtifactCount} linked decision flow(s)`,
      );
    }
    if (linkedArtifactCount > 0) {
      await this.workspaceArtifacts.deleteBySource(workspaceId, documentId);
    }

    // Delete from blob storage (skip for folders)
    try {
      if (!document.isFolder && document.path) {
        await this.documentService.delete(document.path);
      }
    } catch (error) {
      this.logger.warn('Failed to delete blob', {
        documentId,
        path: document.path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Delete from indexing vectorstore (non-blocking)
    // Only if document was indexed (ready status)
    if (document.indexingStatus === IndexingStatus.READY) {
      this.indexingService.deleteDocumentIndex(documentId, workspaceId).catch((err) => {
        this.logger.warn('Failed to delete document index', {
          documentId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }

    // Preserve the Governance source history before the document row disappears.
    await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentDeletedV1, document);

    // Delete document record
    await this.documentModel.deleteOne({ _id: documentId });

    // Update workspace storage (negative delta)
    if (document.status === DocumentStatus.COMPLETED) {
      await this.workspaceService.updateStorageUsage(workspaceId, -document.size, -1);
    }

    this.logger.debug('Document deleted', {
      documentId,
      workspaceId,
    });
  }

  /**
   * Bulk delete documents
   */
  async bulkDelete(
    workspaceId: string,
    userId: string,
    documentIds: string[],
  ): Promise<BulkDeleteResult> {
    let deleted = 0;
    const failed: string[] = [];

    for (const documentId of documentIds) {
      try {
        await this.delete(workspaceId, userId, documentId);
        deleted++;
      } catch (error) {
        failed.push(documentId);
        this.logger.warn('Failed to delete document in bulk', {
          documentId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { deleted, failed };
  }

  /**
   * Delete all documents in a workspace
   */
  async deleteAllByWorkspace(workspaceId: string): Promise<void> {
    const documents = await this.documentModel.find({
      workspaceId: new Types.ObjectId(workspaceId),
    });

    await this.workspaceArtifacts.deleteAllByWorkspace(workspaceId);

    // Delete indexes from vectorstore for indexed documents (non-blocking, parallel)
    const indexedDocuments = documents.filter(
      (doc) => doc.indexingStatus === IndexingStatus.READY,
    );
    if (indexedDocuments.length > 0) {
      const indexDeletions = indexedDocuments.map((doc) =>
        this.indexingService
          .deleteDocumentIndex(doc._id.toString(), workspaceId)
          .catch((err) => {
            this.logger.warn('Failed to delete document index during workspace cleanup', {
              documentId: doc._id,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }),
      );
      await Promise.all(indexDeletions);
    }

    // Delete all blobs (skip for folders)
    const blobDeletions = documents.map((doc) =>
      (!doc.isFolder && doc.path ? this.documentService.delete(doc.path) : Promise.resolve())
        .catch((err) => {
          this.logger.warn('Failed to delete blob during workspace cleanup', {
            path: doc.path,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }),
    );
    await Promise.all(blobDeletions);

    // Calculate storage to reclaim (only completed documents count towards usage)
    const completedDocuments = documents.filter(
      (doc) => doc.status === DocumentStatus.COMPLETED,
    );
    const totalSize = completedDocuments.reduce((sum, doc) => sum + doc.size, 0);

    // Preserve Governance source history before removing document rows.
    for (const document of documents) {
      if (!document.isFolder) await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentDeletedV1, document);
    }

    // Delete all document records
    await this.documentModel.deleteMany({
      workspaceId: new Types.ObjectId(workspaceId),
    });

    // Also delete upload sessions
    await this.uploadSessionModel.deleteMany({
      workspaceId: new Types.ObjectId(workspaceId),
    });

    // Update workspace storage usage
    if (completedDocuments.length > 0) {
      await this.workspaceService.updateStorageUsage(
        workspaceId,
        -totalSize,
        -completedDocuments.length,
      );
    }

    this.logger.debug('All documents deleted from workspace', {
      workspaceId,
      count: documents.length,
      indexedCount: indexedDocuments.length,
      storageReclaimed: totalSize,
    });
  }
}
