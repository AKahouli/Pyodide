import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import {
  WorkspaceDoc,
  WorkspaceDocumentDoc,
  DocumentStatus,
  DocumentType,
} from '../schemas/workspace-document.schema';
import { escapeRegex } from '../../../common/utils';
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
    @InjectModel(WorkspaceDoc.name)
    private readonly documentModel: Model<WorkspaceDocumentDoc>,
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

    const objectIds = documentIds.map((id) => new Types.ObjectId(id));
    const documents = await this.documentModel.find({ _id: { $in: objectIds } }).exec();

    return documents.map((d) => this.support.mapToResponse(d));
  }

  /**
   * Find multiple documents by IDs, scoped to a single workspace. IDs that do
   * not belong to the workspace are silently absent from the result.
   */
  async findByIdsInWorkspace(workspaceId: string, documentIds: string[]): Promise<DocumentResponse[]> {
    if (documentIds.length === 0) return [];

    const objectIds = documentIds.map((id) => new Types.ObjectId(id));
    const documents = await this.documentModel
      .find({ _id: { $in: objectIds }, workspaceId: new Types.ObjectId(workspaceId) })
      .exec();

    return documents.map((d) => this.support.mapToResponse(d));
  }

  /** Merge string flags into a document's metadata (workspace-scoped). */
  async mergeMetadata(workspaceId: string, documentId: string, patch: Record<string, string>): Promise<void> {
    const setObject = Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [`metadata.${key}`, value]),
    );
    await this.documentModel
      .updateOne(
        { _id: new Types.ObjectId(documentId), workspaceId: new Types.ObjectId(workspaceId) },
        { $set: setObject },
      )
      .exec();
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

    // Build query — default to completed so pending/failed uploads are hidden
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      status: status || DocumentStatus.COMPLETED,
    };

    // Filter by parent folder ID
    if (parentId === null || parentId === undefined) {
      // Root level: show items with no parent
      query.parentId = { $in: [null, undefined] };
    } else if (parentId) {
      // Specific folder: show items in that folder
      query.parentId = new Types.ObjectId(parentId);
    }

    if (search) {
      query.$or = [
        { originalName: { $regex: escapeRegex(search), $options: 'i' } },
        { folderName: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    // Build sort - folders first
    const sort: Record<string, 1 | -1> = {
      isFolder: -1,
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Execute queries
    // Count includes both folders and documents for accurate pagination
    const [documents, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);

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

    const query: Record<string, unknown> = {
      workspaceId: { $in: workspaceIds.map((id) => new Types.ObjectId(id)) },
      status: status || DocumentStatus.COMPLETED,
    };

    if (search) {
      const namePattern = { $regex: escapeRegex(search), $options: 'i' };
      if (searchFilename) {
        query.$or = [{ originalName: namePattern }, { filename: namePattern }];
      } else {
        query.originalName = namePattern;
      }
    }

    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    const [documents, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);

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

    return this.support.mapToResponse(document);
  }

  /**
   * Get download URL for a document
   */
  async getDownloadUrl(
    workspaceId: string,
    documentId: string,
  ): Promise<DownloadUrlResponse> {
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

    // Build query
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      ...(includeAllStatuses ? {} : { status: status || DocumentStatus.COMPLETED }),
    };

    if (search) {
      query.originalName = { $regex: escapeRegex(search), $options: 'i' };
    }

    // Build sort
    const sort: Record<string, 1 | -1> = {
      isFolder: -1, // Folders first
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Execute queries
    const [items, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);

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
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      isFolder: true,
      status: DocumentStatus.COMPLETED,
    };

    const folders = await this.documentModel
      .find(query)
      .sort({ originalName: 1 })
      .exec();

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

    // Build query for folder contents
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      parentId: new Types.ObjectId(folderId),
      status: DocumentStatus.COMPLETED,
    };

    if (search) {
      query.$or = [
        { originalName: { $regex: escapeRegex(search), $options: 'i' } },
        { folderName: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    // Build sort - folders first
    const sort: Record<string, 1 | -1> = {
      isFolder: -1,
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Execute queries
    // Count includes both folders and documents for accurate pagination
    const [items, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);

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

  async checkUrls(workspaceId: string, urls: string[]): Promise<{ results: Array<Record<string, unknown>> }> {
    const normalized = urls.map((url) => ({ url, normalizedUrl: normalizeWorkspaceUrl(url) }));
    const documents = await this.documentModel.find({
      workspaceId: new Types.ObjectId(workspaceId),
      type: DocumentType.URL,
      sourceUrl: { $exists: true },
    }).select('_id sourceUrl status indexingStatus').lean().exec();
    const byNormalized = new Map(documents.map((doc) => [normalizeWorkspaceUrl(doc.sourceUrl ?? ''), doc]));
    return {
      results: normalized.map(({ url, normalizedUrl }) => {
        const document = byNormalized.get(normalizedUrl);
        return {
          url,
          normalizedUrl,
          exists: Boolean(document),
          documentId: document?._id?.toString(),
          status: document?.status,
          indexingStatus: document?.indexingStatus,
        };
      }),
    };
  }
}
