import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
    visited = new Set<string>(),
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
    visited = new Set<string>(),
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

    // Indexing may have persisted data before failing or reporting completion.
    this.indexingService.deleteDocumentIndex(document.id, workspaceId).catch((err) => {
      this.logger.warn('Failed to delete document index', {
        documentId: document.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    });

    // Preserve the Governance source history before the document row disappears.
    await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentDeletedV1, document);

    await this.documentStore.deleteById(document.id);

    // Update workspace storage (negative delta)
    if (document.status === DocumentStatus.COMPLETED) {
      await this.workspaceService.updateStorageUsage(workspaceId, -document.size, -1);
    }
  }

  /** Conversation deletion retains a private tombstone so retries cannot refund quota twice. */
  async deleteConversationAsset(workspaceId: string, documentId: string, conversationId?: string): Promise<{
    deleted: true; alreadyDeleted: boolean; cleanup: { blob: 'done' | 'pending'; index: 'done' | 'pending' };
  }> {
    const claimed = await this.documentStore.withWorkspaceTreeLock(workspaceId, async () => {
      const document = await this.documentStore.findByIdAndWorkspace(documentId, workspaceId);
      if (!document || document.isFolder) throw new NotFoundException(ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND, 'Document not found');
      if (document.metadata?.assetDeletedAt) return { document, alreadyDeleted: true };
      if (await this.workspaceArtifacts.countBySource(workspaceId, documentId) > 0) {
        throw new ConflictException(ErrorCode.WORKSPACE_DOCUMENT_HAS_DERIVED_ARTIFACTS, 'Document has linked decision flows');
      }
      const metadata: Record<string, string> = { ...document.metadata, assetDeletedAt: new Date().toISOString(), assetBlobCleanup: 'pending', assetIndexCleanup: 'pending' };
      await this.documentStore.updateById(documentId, { status: DocumentStatus.FAILED, metadata });
      if (document.status === DocumentStatus.COMPLETED) await this.workspaceService.updateStorageUsage(workspaceId, -document.size, -1);
      await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentDeletedV1, document);
      return { document: { ...document, metadata }, alreadyDeleted: false };
    });
    const cleanup = { blob: claimed.document.metadata?.assetBlobCleanup === 'done' ? 'done' as const : 'pending' as const,
      index: claimed.document.metadata?.assetIndexCleanup === 'done' ? 'done' as const : 'pending' as const };
    if (cleanup.blob !== 'done') {
      try {
        const paths = new Set<string>(claimed.document.path ? [claimed.document.path] : []);
        let sourceAlias: string | undefined;
        if (claimed.document.metadata?.assetSourcePath) {
          const source = claimed.document.metadata.assetSourcePath;
          const sourceConversation = conversationId ?? claimed.document.metadata.assetStagingConversationId;
          if (!sourceConversation || !source.startsWith(`${claimed.document.createdBy}/system_${sourceConversation}/`)
            || /[\\\x00-\x1f\x7f]/.test(source) || source.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid source provenance');
          sourceAlias = source;
        }
        const sha256 = claimed.document.metadata?.assetStagedSha256;
        const stagedConversationId = claimed.document.metadata?.assetStagingConversationId;
        if (sha256 && stagedConversationId) {
          const actors: string[] = JSON.parse(claimed.document.metadata?.assetStagedActors ?? '[]');
          if (!/^[a-f0-9]{64}$/.test(sha256) || !/^[a-zA-Z0-9_-]{1,64}$/.test(stagedConversationId)
            || !Array.isArray(actors) || actors.length > 32 || actors.some(actor => !/^[a-zA-Z0-9_-]{1,64}$/.test(actor))) throw new Error('Invalid staging provenance');
          const ref = Buffer.from(JSON.stringify(['document', workspaceId, documentId])).toString('base64url');
          const identity = createHash('sha256').update(`${ref}\n${sha256}`).digest('hex');
          const extension = (claimed.document.metadata?.assetDisplayName ?? claimed.document.originalName).match(/\.([a-zA-Z0-9]{1,10})$/)?.[1].toLowerCase() ?? 'bin';
          for (const actor of actors) paths.add(`${actor}/system_${stagedConversationId}/conversation-assets/${identity}.${extension}`);
        }
        const legacyActors: string[] = JSON.parse(claimed.document.metadata?.assetLegacyStagedActors ?? '[]');
        if (!Array.isArray(legacyActors) || legacyActors.length > 32
          || legacyActors.some(actor => !/^[a-zA-Z0-9_-]{1,64}$/.test(actor))) throw new Error('Invalid image staging provenance');
        const imageExtension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[claimed.document.mimeType];
        const imageConversation = conversationId ?? stagedConversationId;
        if (imageExtension && imageConversation) for (const actor of legacyActors) {
          paths.add(`${actor}/system_${imageConversation}/generated-images/${documentId}.${imageExtension}`);
        }
        for (const path of paths) await this.documentService.delete(path);
        if (sourceAlias && await this.documentService.exists(sourceAlias)) {
          const expected = claimed.document.metadata?.assetContentSha256;
          if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Missing source content provenance');
          const stream = await this.documentService.openReadStream(sourceAlias);
          const hash = createHash('sha256'); let size = 0;
          const timeout = setTimeout(() => stream.body.destroy(new Error('Source cleanup timed out')), 30_000);
          try {
            for await (const chunk of stream.body) {
              size += chunk.length;
              if (size > 50 * 1024 * 1024) throw new Error('Source cleanup exceeds size limit');
              hash.update(chunk);
            }
          } finally { clearTimeout(timeout); stream.body.destroy(); }
          // A coordinator may reuse a filename: a newer run's bytes are a separate output.
          if (hash.digest('hex') === expected) await this.documentService.delete(sourceAlias);
        }
        cleanup.blob = 'done';
      }
      catch { this.logger.warn('Conversation asset blob cleanup pending', { documentId, workspaceId }); }
    }
    if (cleanup.index !== 'done') {
      try {
        const neverIndexed = claimed.document.indexingStatus === IndexingStatus.NONE && claimed.document.metadata?.autoIndexRequested === 'false'
          && !claimed.document.indexingTaskId && !claimed.document.lastIndexedAt;
        if (!neverIndexed) await this.indexingService.deleteDocumentIndex(documentId, workspaceId, true);
        cleanup.index = 'done';
      }
      catch { this.logger.warn('Conversation asset index cleanup pending', { documentId, workspaceId }); }
    }
    await this.documentStore.mergeMetadata(workspaceId, documentId, { assetBlobCleanup: cleanup.blob, assetIndexCleanup: cleanup.index });
    return { deleted: true, alreadyDeleted: claimed.alreadyDeleted, cleanup };
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
    if (document.metadata?.assetDeletedAt) {
      await this.deleteConversationAsset(workspaceId, documentId);
      return;
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

    // Clean up every file regardless of its last reported indexing status.
    const files = documents.filter((doc) => !doc.isFolder);
    if (files.length > 0) {
      const indexDeletions = files.map((doc) =>
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
      indexDeletionCount: files.length,
      storageReclaimed: totalSize,
    });
  }
}
