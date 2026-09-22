import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { newObjectId } from '@common/postgres';
import { DocumentStatus, DocumentType, IndexingStatus } from '../interfaces/document-status.enum';
import { DOCUMENT_STORE, type DocumentStore } from '../stores/document-store';
import type { WorkspaceDocumentRecord } from '../ports/workspace-records';
import { UPLOAD_SESSION_STORE, type UploadSessionStore } from '../stores/upload-session-store';
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

/** Guard against runaway recursion on a corrupted (cyclic) folder tree. */
const MAX_FOLDER_DEPTH = 100;

@Injectable()
export class WorkspaceDocumentTree {
  constructor(
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    @Inject(UPLOAD_SESSION_STORE) private readonly uploadSessionStore: UploadSessionStore,
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
    const existing = await this.documentStore.findFolderDuplicate({
      workspaceId,
      createdBy: userId,
      folderName: sanitizedName,
      parentId: parentId ?? null,
    });
    if (existing) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'A folder with this name already exists in this location',
      );
    }

    // Create folder record
    const folderId = newObjectId();
    const folderPath = `folder:${folderId}`; // Unique path for folders

    const folder = await this.documentStore.create({
      id: folderId,
      filename: '', // Folders don't have files
      originalName: sanitizedName,
      mimeType: 'folder',
      size: 0,
      path: folderPath, // Unique path for folders to avoid duplicate key error
      workspaceId,
      createdBy: userId,
      status: DocumentStatus.COMPLETED,
      isFolder: true,
      folderName: sanitizedName,
      parentId: parentId ?? null,
    });

    this.logger.log('Folder created', {
      folderId: folder.id,
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
    const folder = await this.documentStore.findById(folderId);

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
    if (folder.createdBy !== userId) {
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
    const existing = await this.documentStore.findFolderDuplicate({
      workspaceId: folder.workspaceId,
      createdBy: folder.createdBy,
      folderName: sanitizedName,
      parentId: folder.parentId ?? null,
      excludeId: folderId,
    });
    if (existing) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'A folder with this name already exists in this location',
      );
    }

    const renamed = await this.documentStore.renameFolder(folderId, sanitizedName);

    this.logger.log('Folder renamed', {
      folderId,
      userId,
      oldName: renamed!.originalName,
      newName: sanitizedName,
    });

    return this.support.mapToResponse(renamed!);
  }

  /**
   * Delete a folder and all its contents recursively
   */
  async deleteFolder(
    workspaceId: string,
    userId: string,
    folderId: string,
  ): Promise<{ deletedFolders: number; deletedDocuments: number }> {
    const folder = await this.documentStore.findByIdAndWorkspace(folderId, workspaceId);

    if (!folder) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Folder not found',
      );
    }

    if (!folder.isFolder) {
      throw new BadRequestException('Document is not a folder');
    }

    if (folder.createdBy !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this folder',
      );
    }

    const result = await this.deleteFolderTree(folderId, workspaceId, userId, false);

    this.logger.log('Folder deleted', {
      folderId,
      workspaceId,
      deletedFolders: result.deletedFolders,
      deletedDocuments: result.deletedDocuments,
    });

    return result;
  }

  /**
   * Delete a folder, every descendant (children before parents) and the folder
   * row itself. Every descendant document goes through the same cleanup as a
   * single-document delete (blob, index, governance event, counters), so the
   * `parent_id ON DELETE CASCADE` never has to remove rows behind our back.
   */
  private async deleteFolderTree(
    folderId: string,
    workspaceId: string,
    userId: string,
    cascadeArtifacts: boolean,
  ): Promise<{ deletedFolders: number; deletedDocuments: number }> {
    const descendantDocumentIds = await this.collectFolderDocumentIds(folderId, workspaceId);
    const linkedArtifactCount =
      await this.workspaceArtifacts.countBySourceDocumentIds(descendantDocumentIds);
    if (linkedArtifactCount > 0 && !cascadeArtifacts) {
      throw new ConflictException(
        ErrorCode.WORKSPACE_DOCUMENT_HAS_DERIVED_ARTIFACTS,
        'Delete linked decision flows before deleting this folder',
      );
    }
    if (linkedArtifactCount > 0) {
      for (const documentId of descendantDocumentIds) {
        await this.workspaceArtifacts.deleteBySource(workspaceId, documentId);
      }
    }

    const result = await this.deleteFolderRecursive(folderId, workspaceId, userId);
    await this.documentStore.deleteByIdAndWorkspace(folderId, workspaceId);
    return {
      deletedFolders: result.deletedFolders + 1,
      deletedDocuments: result.deletedDocuments,
    };
  }

  /**
   * Recursively delete folder contents (children before parents).
   * `visited`/`depth` guard against a pre-existing parent cycle.
   */
  private async deleteFolderRecursive(
    folderId: string,
    workspaceId: string,
    userId: string,
    visited: Set<string> = new Set(),
    depth = 0,
  ): Promise<{ deletedFolders: number; deletedDocuments: number }> {
    this.enterFolder(folderId, visited, depth);
    const items = await this.documentStore.findDirectChildren(folderId, workspaceId);

    let deletedFolders = 0;
    let deletedDocuments = 0;

    for (const item of items) {
      if (item.isFolder) {
        if (visited.has(item.id)) continue;
        const subResult = await this.deleteFolderRecursive(
          item.id,
          workspaceId,
          userId,
          visited,
          depth + 1,
        );
        deletedFolders += subResult.deletedFolders + 1;
        deletedDocuments += subResult.deletedDocuments;
        await this.documentStore.deleteById(item.id);
      } else {
        await this.removeDocument(item, workspaceId);
        deletedDocuments++;
      }
    }

    return { deletedFolders, deletedDocuments };
  }

  private async collectFolderDocumentIds(
    folderId: string,
    workspaceId: string,
    visited: Set<string> = new Set(),
    depth = 0,
  ): Promise<string[]> {
    this.enterFolder(folderId, visited, depth);
    const items = await this.documentStore.findDirectChildren(folderId, workspaceId);
    const ids: string[] = [];
    for (const item of items) {
      if (item.isFolder) {
        if (visited.has(item.id)) continue;
        ids.push(...await this.collectFolderDocumentIds(item.id, workspaceId, visited, depth + 1));
      } else {
        ids.push(item.id);
      }
    }
    return ids;
  }

  private enterFolder(folderId: string, visited: Set<string>, depth: number): void {
    if (depth > MAX_FOLDER_DEPTH) {
      throw new BadRequestException('Folder tree is too deep');
    }
    visited.add(folderId);
  }

  /**
   * Blob, vector index, governance event, row and counters for one
   * non-folder document. Linked artifacts must already be handled.
   */
  private async removeDocument(document: WorkspaceDocumentRecord, workspaceId: string): Promise<void> {
    // Delete from blob storage
    try {
      if (document.path) {
        await this.documentService.delete(document.path);
      }
    } catch (error) {
      this.logger.warn('Failed to delete blob', {
        documentId: document.id,
        path: document.path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Delete from indexing vectorstore (non-blocking), only if indexed
    if (document.indexingStatus === IndexingStatus.READY) {
      this.indexingService.deleteDocumentIndex(document.id, workspaceId).catch((err) => {
        this.logger.warn('Failed to delete document index', {
          documentId: document.id,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }

    // Preserve the Governance source history before the document row disappears.
    await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentDeletedV1, document);

    await this.documentStore.deleteById(document.id);

    // Update workspace storage (negative delta)
    if (document.status === DocumentStatus.COMPLETED) {
      await this.workspaceService.updateStorageUsage(workspaceId, -document.size, -1);
    }
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
    const document = await this.documentStore.findByIdAndWorkspace(documentId, workspaceId);

    if (!document) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    if (document.isFolder) {
      // Never delete a folder row directly: parent_id ON DELETE CASCADE would
      // drop descendants without blob/index/outbox/counter cleanup.
      await this.deleteFolderTree(documentId, workspaceId, userId, cascadeArtifacts);
      this.logger.debug('Folder deleted', { documentId, workspaceId });
      return;
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

    await this.removeDocument(document, workspaceId);

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
    const documents = await this.documentStore.findAllByWorkspaceId(workspaceId);

    await this.workspaceArtifacts.deleteAllByWorkspace(workspaceId);

    // Delete indexes from vectorstore for indexed documents (non-blocking, parallel)
    const indexedDocuments = documents.filter(
      (doc) => doc.indexingStatus === IndexingStatus.READY,
    );
    if (indexedDocuments.length > 0) {
      const indexDeletions = indexedDocuments.map((doc) =>
        this.indexingService
          .deleteDocumentIndex(doc.id, workspaceId)
          .catch((err) => {
            this.logger.warn('Failed to delete document index during workspace cleanup', {
              documentId: doc.id,
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
    await this.documentStore.deleteManyByWorkspace(workspaceId);

    // Also delete upload sessions
    await this.uploadSessionStore.deleteManyByWorkspace(workspaceId);

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
