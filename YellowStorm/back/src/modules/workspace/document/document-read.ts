import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentStatus, DocumentType, IndexingStatus } from '../interfaces/document-status.enum';
import { DOCUMENT_STORE, type DocumentStore } from '../stores/document-store';
import { normalizeWorkspaceUrl } from '../services/url-normalization';
import {
  DocumentQueryParams,
  DocumentResponse,
  PaginatedDocuments,
  DownloadUrlResponse,
} from '../interfaces/workspace-document.interface';
import { DocumentService } from '../../document/document.service';
import { LoggerService } from '../../logger';
import {
  NotFoundException,
  BadRequestException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkspaceDocumentSupport } from './document-support';

@Injectable()
export class WorkspaceDocumentRead {
  private readonly sasUrlExpiryMinutes: number;

  constructor(
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    private readonly documentService: DocumentService,
    private readonly configService: ConfigService,
    private readonly support: WorkspaceDocumentSupport,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkspaceDocumentRead');
    this.sasUrlExpiryMinutes = this.configService.get<number>('workspace.sasUrlExpiryMinutes', 60);
  }

  /**
   * Find multiple documents by their IDs (across any workspace).
   * Returns documents in no particular order.
   */
  async findByIds(documentIds: string[]): Promise<DocumentResponse[]> {
    if (documentIds.length === 0) return [];

    const documents = await this.documentStore.findByIds(documentIds);

    return documents.map((d) => this.support.mapToResponse(d));
  }

  /**
   * Find multiple documents by IDs, scoped to a single workspace. IDs that do
   * not belong to the workspace are silently absent from the result.
   */
  async findByIdsInWorkspace(workspaceId: string, documentIds: string[]): Promise<DocumentResponse[]> {
    if (documentIds.length === 0) return [];

    const documents = await this.documentStore.findByIdsInWorkspace(workspaceId, documentIds);

    return documents.map((d) => this.support.mapToResponse(d));
  }

  /** Merge string flags into a document's metadata (workspace-scoped). */
  async mergeMetadata(workspaceId: string, documentId: string, patch: Record<string, string>): Promise<void> {
    await this.documentStore.mergeMetadata(workspaceId, documentId, patch);
  }

  /**
   * Generate a presigned read URL for a document by its path.
   * Pass `allowExtensionless` for app-source objects like Dockerfile / LICENSE.
   */
  async generateReadUrl(
    path: string,
    options?: { allowExtensionless?: boolean },
  ): Promise<string> {
    return this.documentService.generateSasUrl(path, {
      permissions: 'r',
      expiryMinutes: this.sasUrlExpiryMinutes,
      allowExtensionless: options?.allowExtensionless,
    });
  }

  /**
   * Every completed document and folder of a workspace, at all levels, unpaginated. For callers that
   * must see a whole workspace at once (a semantic mapping applied to all of its files).
   */
  async listAllInWorkspace(workspaceId: string): Promise<DocumentResponse[]> {
    const documents = await this.documentStore.findAllByWorkspaceId(workspaceId);
    return documents
      .filter((document) => document.status === DocumentStatus.COMPLETED)
      .map((document) => this.support.mapToResponse(document));
  }

  /**
   * List documents in a workspace
   */
  async findAllByWorkspace(
    workspaceId: string,
    params: DocumentQueryParams,
  ): Promise<PaginatedDocuments> {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      parentId,
    } = params;

    const skip = (page - 1) * limit;

    // Count includes both folders and documents for accurate pagination
    const { items: documents, total } = await this.documentStore.listByWorkspace(workspaceId, {
      status: status || DocumentStatus.COMPLETED,
      search,
      parentId: parentId ?? null,
      sortBy,
      sortOrder,
      skip,
      limit,
    });

    return {
      documents: documents.map((d) => this.support.mapToResponse(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * List documents across multiple workspaces
   */
  async findByMultipleWorkspaces(
    workspaceIds: string[],
    params: DocumentQueryParams,
  ): Promise<PaginatedDocuments> {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      searchFilename,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const skip = (page - 1) * limit;

    const { items: documents, total } = await this.documentStore.listByWorkspaces(workspaceIds, {
      status: status || DocumentStatus.COMPLETED,
      search,
      searchFilename,
      sortBy,
      sortOrder,
      skip,
      limit,
    });

    return {
      documents: documents.map((d) => this.support.mapToResponse(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get document by ID
   */
  async findById(
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentResponse> {
    const document = await this.documentStore.findByIdAndWorkspace(documentId, workspaceId);

    if (!document) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    return this.support.mapToResponse(document);
  }

  /**
   * Get download URL for a document
   */
  async getDownloadUrl(
    workspaceId: string,
    documentId: string,
  ): Promise<DownloadUrlResponse> {
    const document = await this.documentStore.findByIdAndWorkspace(documentId, workspaceId);

    if (!document) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    if (document.isFolder) {
      throw new BadRequestException(
        'Folders cannot be downloaded directly',
      );
    }

    if (document.status !== DocumentStatus.COMPLETED) {
      throw new BadRequestException(
        'Document is not available for download',
      );
    }

    const url = await this.documentService.generateSasUrl(document.path!, {
      permissions: 'r',
      expiryMinutes: this.sasUrlExpiryMinutes,
      contentDisposition: `attachment; filename="${document.originalName}"`,
      checkExists: true,
    });

    const expiresAt = new Date(Date.now() + this.sasUrlExpiryMinutes * 60 * 1000);

    return {
      url,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Get all documents and folders in a hierarchical structure
   */
  async findAllSorted(
    workspaceId: string,
    params: DocumentQueryParams,
  ): Promise<PaginatedDocuments> {
    const {
      page = 1,
      limit = 100,
      status,
      includeAllStatuses = false,
      search,
      sortBy = 'originalName',
      sortOrder = 'asc',
    } = params;

    const skip = (page - 1) * limit;

    const { items, total } = await this.documentStore.listByWorkspace(workspaceId, {
      status: includeAllStatuses ? undefined : (status || DocumentStatus.COMPLETED),
      search,
      sortBy,
      sortOrder,
      skip,
      limit,
    });

    return {
      documents: items.map((d) => this.support.mapToResponse(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get all folders in a workspace (no pagination, for sidebar tree view)
   */
  async getAllFolders(workspaceId: string): Promise<DocumentResponse[]> {
    const folders = await this.documentStore.listFolders(workspaceId);

    return folders.map((d) => this.support.mapToResponse(d));
  }

  /**
   * Get contents of a specific folder
   */
  async getFolderContents(
    workspaceId: string,
    folderId: string,
    params: DocumentQueryParams,
  ): Promise<PaginatedDocuments> {
    const {
      page = 1,
      limit = 50,
      search,
      sortBy = 'originalName',
      sortOrder = 'asc',
    } = params;

    const skip = (page - 1) * limit;

    // Count includes both folders and documents for accurate pagination
    const { items, total } = await this.documentStore.listFolderContents(workspaceId, folderId, {
      search,
      sortBy,
      sortOrder,
      skip,
      limit,
    });

    return {
      documents: items.map((d) => this.support.mapToResponse(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async checkUrls(workspaceId: string, urls: string[]): Promise<{ results: Record<string, unknown>[] }> {
    const normalized = urls.map((url) => ({ url, normalizedUrl: normalizeWorkspaceUrl(url) }));
    const documents = await this.documentStore.findUrlSources(workspaceId);
    const byNormalized = new Map(documents.map((doc) => [normalizeWorkspaceUrl(doc.sourceUrl ?? ''), doc]));
    return {
      results: normalized.map(({ url, normalizedUrl }) => {
        const document = byNormalized.get(normalizedUrl);
        return {
          url,
          normalizedUrl,
          exists: Boolean(document),
          documentId: document?.id,
          status: document?.status,
          indexingStatus: document?.indexingStatus,
        };
      }),
    };
  }
}
