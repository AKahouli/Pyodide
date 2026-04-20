import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  WorkspaceDoc,
  WorkspaceDocumentDoc,
  DocumentStatus,
  IndexingStatus,
} from './schemas/workspace-document.schema';
import { escapeRegex } from '../../common/utils';
import { IndexingService } from '../indexing/indexing.service';
import {
  UploadSession,
  UploadSessionDocument,
  UploadSessionStatus,
} from './schemas/upload-session.schema';
import {
  RequestUploadUrlData,
  UploadUrlResponse,
  DocumentQueryParams,
  DocumentResponse,
  PaginatedDocuments,
  DownloadUrlResponse,
  BulkDeleteResult,
} from './interfaces/workspace-document.interface';
import {
  InitiateBulkUploadData,
  BulkUploadInitResponse,
  ReportProgressData,
  UploadSessionResponse,
  BulkUploadCompleteResponse,
  UploadProgressNotification,
} from './interfaces/upload-session.interface';
import { WorkspaceService } from './workspace.service';
import { DocumentService } from '../document/document.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { LoggerService } from '../logger';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';

@Injectable()
export class WorkspaceDocumentService {
  private readonly maxFileSizeMb: number;
  private readonly maxFilesPerBulkUpload: number;
  private readonly smallFileThresholdMb: number;
  private readonly uploadSessionTtlMinutes: number;
  private readonly sasUrlExpiryMinutes: number;
  private readonly allowedMimeTypes: string[];

  constructor(
    @InjectModel(WorkspaceDoc.name)
    private readonly documentModel: Model<WorkspaceDocumentDoc>,
    @InjectModel(UploadSession.name)
    private readonly uploadSessionModel: Model<UploadSessionDocument>,
    private readonly workspaceService: WorkspaceService,
    private readonly documentService: DocumentService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => IndexingService))
    private readonly indexingService: IndexingService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkspaceDocumentService');

    this.maxFileSizeMb = this.configService.get<number>('workspace.maxFileSizeMb', 500);
    this.maxFilesPerBulkUpload = this.configService.get<number>('workspace.maxFilesPerBulkUpload', 50);
    this.smallFileThresholdMb = this.configService.get<number>('workspace.smallFileThresholdMb', 10);
    this.uploadSessionTtlMinutes = this.configService.get<number>('workspace.uploadSessionTtlMinutes', 60);
    this.sasUrlExpiryMinutes = this.configService.get<number>('workspace.sasUrlExpiryMinutes', 60);
    this.allowedMimeTypes = this.configService.get<string[]>('workspace.allowedMimeTypes', []);
  }

  /**
   * Sanitize filename for storage
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[/\\:\0]/g, '_')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .replace(/[_\s]+/g, '_')
      .substring(0, 255);
  }

  /**
   * Generate blob storage path
   */
  private generateBlobPath(
    userId: string,
    workspaceId: string,
    documentId: string,
    filename: string,
  ): string {
    const sanitizedName = this.sanitizeFilename(filename);
    return `${userId}/${workspaceId}/${documentId}/${sanitizedName}`;
  }

  /**
   * Validate file type and size
   */
  private validateFile(mimeType: string, size: number): void {
    // Check MIME type
    if (this.allowedMimeTypes.length > 0 && !this.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(
        `File type '${mimeType}' is not allowed`,
      );
    }

    // Check file size
    const maxSizeBytes = this.maxFileSizeMb * 1024 * 1024;
    if (size > maxSizeBytes) {
      throw new BadRequestException(
        `File size ${Math.round(size / 1024 / 1024)}MB exceeds maximum ${this.maxFileSizeMb}MB`,
      );
    }
  }

  /**
   * Request a presigned URL for uploading a file with a custom blob path prefix.
   * Used for conversation-scoped uploads where the path is {userId}/{conversationId} instead of {userId}/{workspaceId}.
   */
  async requestUploadUrlWithPath(
    workspaceId: string,
    userId: string,
    data: RequestUploadUrlData,
    pathPrefix: string,
  ): Promise<UploadUrlResponse> {
    this.validateFile(data.mimeType, data.size);

    const quota = await this.workspaceService.checkStorageQuota(workspaceId, data.size);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB, Required: ${Math.round(data.size / 1024 / 1024)}MB`,
      );
    }

    const documentId = new Types.ObjectId();
    const sanitizedName = this.sanitizeFilename(data.filename);
    const blobPath = `${pathPrefix}/${documentId}/${sanitizedName}`;

    const document = await this.documentModel.create({
      _id: documentId,
      filename: `${documentId}-${sanitizedName}`,
      originalName: data.filename,
      mimeType: data.mimeType,
      size: data.size,
      path: blobPath,
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.PENDING,
      indexingStatus: IndexingStatus.READY, // Conversation files are not indexed
    });

    const uploadUrl = await this.documentService.generateSasUrl(blobPath, {
      permissions: 'cw',
      expiryMinutes: this.sasUrlExpiryMinutes,
    });

    const expiresAt = new Date(Date.now() + this.sasUrlExpiryMinutes * 60 * 1000);

    this.logger.log('Upload URL generated (custom path)', {
      documentId: document._id,
      workspaceId,
      pathPrefix,
      filename: data.filename,
    });

    return {
      documentId: document._id.toString(),
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Upload a small file directly with a custom blob path prefix.
   * Used for conversation-scoped uploads.
   */
  async uploadSmallFileWithPath(
    workspaceId: string,
    userId: string,
    file: Buffer,
    originalName: string,
    mimeType: string,
    pathPrefix: string,
  ): Promise<DocumentResponse> {
    const size = file.length;

    this.validateFile(mimeType, size);

    const thresholdBytes = this.smallFileThresholdMb * 1024 * 1024;
    if (size > thresholdBytes) {
      throw new BadRequestException(
        `File size exceeds small file threshold (${this.smallFileThresholdMb}MB). Use presigned URL upload instead.`,
      );
    }

    const quota = await this.workspaceService.checkStorageQuota(workspaceId, size);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB`,
      );
    }

    const documentId = new Types.ObjectId();
    const sanitizedName = this.sanitizeFilename(originalName);
    const folder = `${pathPrefix}/${documentId}`;

    const uploaded = await this.documentService.upload(file, originalName, mimeType, {
      folder,
      generateUniqueName: false,
      customFileName: sanitizedName,
    });

    const document = await this.documentModel.create({
      _id: documentId,
      filename: uploaded.storedName,
      originalName,
      mimeType,
      size,
      path: uploaded.blobPath,
      url: uploaded.url,
      contentHash: uploaded.contentHash,
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.COMPLETED,
      uploadedAt: new Date(),
      indexingStatus: IndexingStatus.READY, // Conversation files are not indexed
    });

    await this.workspaceService.updateStorageUsage(workspaceId, size, 1);

    this.logger.log('Small file uploaded (custom path)', {
      documentId: document._id,
      workspaceId,
      pathPrefix,
      size,
    });

    return this.mapToResponse(document);
  }

  /**
   * Find multiple documents by their IDs (across any workspace).
   * Returns documents in no particular order.
   */
  async findByIds(documentIds: string[]): Promise<DocumentResponse[]> {
    if (documentIds.length === 0) return [];

    const objectIds = documentIds.map((id) => new Types.ObjectId(id));
    const documents = await this.documentModel.find({ _id: { $in: objectIds } }).exec();

    return documents.map((d) => this.mapToResponse(d));
  }

  /**
   * Generate a presigned read URL for a document by its path.
   */
  async generateReadUrl(path: string): Promise<string> {
    return this.documentService.generateSasUrl(path, {
      permissions: 'r',
      expiryMinutes: this.sasUrlExpiryMinutes,
    });
  }

  /**
   * Request a presigned URL for uploading a large file
   */
  async requestUploadUrl(
    workspaceId: string,
    userId: string,
    data: RequestUploadUrlData,
  ): Promise<UploadUrlResponse> {
    // Validate file
    this.validateFile(data.mimeType, data.size);

    // Check storage quota
    const quota = await this.workspaceService.checkStorageQuota(workspaceId, data.size);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB, Required: ${Math.round(data.size / 1024 / 1024)}MB`,
      );
    }

    // Create pending document record
    const documentId = new Types.ObjectId();
    const blobPath = this.generateBlobPath(
      userId,
      workspaceId,
      documentId.toString(),
      data.filename,
    );

    const document = await this.documentModel.create({
      _id: documentId,
      filename: `${documentId}-${this.sanitizeFilename(data.filename)}`,
      originalName: data.filename,
      mimeType: data.mimeType,
      size: data.size,
      path: blobPath,
      // url is set after upload completes
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.PENDING,
    });

    // Generate presigned URL with write permission
    const uploadUrl = await this.documentService.generateSasUrl(blobPath, {
      permissions: 'cw', // Create and Write
      expiryMinutes: this.sasUrlExpiryMinutes,
    });

    const expiresAt = new Date(Date.now() + this.sasUrlExpiryMinutes * 60 * 1000);

    this.logger.log('Upload URL generated', {
      documentId: document._id,
      workspaceId,
      filename: data.filename,
    });

    return {
      documentId: document._id.toString(),
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Confirm upload completion
   */
  async confirmUpload(
    workspaceId: string,
    userId: string,
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

    if (document.status !== DocumentStatus.PENDING) {
      throw new BadRequestException(
        'Document is not in pending state',
      );
    }

    // Verify blob exists in Azure (skip for folders)
    if (!document.isFolder && document.path) {
      const exists = await this.documentService.exists(document.path);
      if (!exists) {
        throw new BadRequestException(
          'Document was not uploaded to storage',
        );
      }
    }

    // Update document status
    document.status = DocumentStatus.COMPLETED;
    document.uploadedAt = new Date();
    document.url = document.path; // Base path without SAS token
    await document.save();

    // Update workspace storage usage
    await this.workspaceService.updateStorageUsage(workspaceId, document.size, 1);

    // Send notification
    await this.sendUploadNotification(userId, {
      eventType: 'upload_complete',
      sessionId: '',
      filename: document.originalName,
      document: this.mapToResponse(document),
    });

    this.logger.log('Upload confirmed', {
      documentId: document._id,
      workspaceId,
    });

    return this.mapToResponse(document);
  }

  /**
   * Upload a small file directly
   */
  async uploadSmallFile(
    workspaceId: string,
    userId: string,
    file: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<DocumentResponse> {
    const size = file.length;

    // Validate file
    this.validateFile(mimeType, size);

    // Check if file is truly "small"
    const thresholdBytes = this.smallFileThresholdMb * 1024 * 1024;
    if (size > thresholdBytes) {
      throw new BadRequestException(
        `File size exceeds small file threshold (${this.smallFileThresholdMb}MB). Use presigned URL upload instead.`,
      );
    }

    // Check storage quota
    const quota = await this.workspaceService.checkStorageQuota(workspaceId, size);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB`,
      );
    }

    // Create document record
    const documentId = new Types.ObjectId();
    const blobPath = this.generateBlobPath(
      userId,
      workspaceId,
      documentId.toString(),
      originalName,
    );

    // Upload to Azure
    const uploaded = await this.documentService.upload(file, originalName, mimeType, {
      folder: `${userId}/${workspaceId}/${documentId}`,
      generateUniqueName: false,
      customFileName: this.sanitizeFilename(originalName),
    });

    // Create document record
    const document = await this.documentModel.create({
      _id: documentId,
      filename: uploaded.storedName,
      originalName,
      mimeType,
      size,
      path: uploaded.blobPath,
      url: uploaded.url,
      contentHash: uploaded.contentHash,
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.COMPLETED,
      uploadedAt: new Date(),
    });

    // Update workspace storage
    await this.workspaceService.updateStorageUsage(workspaceId, size, 1);

    this.logger.log('Small file uploaded', {
      documentId: document._id,
      workspaceId,
      size,
    });

    return this.mapToResponse(document);
  }

  /**
   * Initiate bulk upload session
   */
  async initiateBulkUpload(
    workspaceId: string,
    userId: string,
    data: InitiateBulkUploadData,
  ): Promise<BulkUploadInitResponse> {
    const files = data.files;

    // Validate file count
    if (files.length > this.maxFilesPerBulkUpload) {
      throw new BadRequestException(
        `Cannot upload more than ${this.maxFilesPerBulkUpload} files at once`,
      );
    }

    // Validate all files and calculate total size
    let totalSize = 0;
    for (const file of files) {
      this.validateFile(file.mimeType, file.size);
      totalSize += file.size;
    }

    // Check total storage quota
    const quota = await this.workspaceService.checkStorageQuota(workspaceId, totalSize);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB, Required: ${Math.round(totalSize / 1024 / 1024)}MB`,
      );
    }

    // Create upload session
    const expiresAt = new Date(Date.now() + this.uploadSessionTtlMinutes * 60 * 1000);
    const sessionFiles: Array<{
      index: number;
      filename: string;
      mimeType: string;
      size: number;
      documentId: Types.ObjectId;
      uploadUrl: string;
      status: string;
      progress: number;
    }> = [];

    const responseFiles: BulkUploadInitResponse['files'] = [];

    // Create document records and generate URLs for each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const documentId = new Types.ObjectId();
      const blobPath = this.generateBlobPath(
        userId,
        workspaceId,
        documentId.toString(),
        file.filename,
      );

      // Create pending document (url is set after upload completes)
      await this.documentModel.create({
        _id: documentId,
        filename: `${documentId}-${this.sanitizeFilename(file.filename)}`,
        originalName: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        path: blobPath,
        workspaceId: new Types.ObjectId(workspaceId),
        createdBy: new Types.ObjectId(userId),
        status: DocumentStatus.PENDING,
      });

      // Generate presigned URL
      const uploadUrl = await this.documentService.generateSasUrl(blobPath, {
        permissions: 'cw',
        expiryMinutes: this.sasUrlExpiryMinutes,
      });

      sessionFiles.push({
        index: i,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        documentId,
        uploadUrl,
        status: 'pending',
        progress: 0,
      });

      responseFiles.push({
        index: i,
        filename: file.filename,
        uploadUrl,
        documentId: documentId.toString(),
      });
    }

    // Create session record
    const session = await this.uploadSessionModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(userId),
      status: UploadSessionStatus.PENDING,
      files: sessionFiles,
      totalFiles: files.length,
      totalSize,
      completedFiles: 0,
      failedFiles: 0,
      expiresAt,
    });

    this.logger.log('Bulk upload session created', {
      sessionId: session._id,
      workspaceId,
      fileCount: files.length,
      totalSize,
    });

    return {
      sessionId: session._id.toString(),
      files: responseFiles,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Report upload progress for a file in bulk upload
   * Note: This only updates the session state for tracking/debugging.
   * SSE notifications are NOT sent for progress updates since the frontend
   * already knows the progress (it's doing the upload directly to Azure).
   * SSE is only used for completion/failure notifications.
   */
  async reportProgress(
    workspaceId: string,
    userId: string,
    sessionId: string,
    data: ReportProgressData,
  ): Promise<void> {
    const session = await this.uploadSessionModel.findOne({
      _id: sessionId,
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(userId),
    });

    if (!session) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_UPLOAD_SESSION_NOT_FOUND,
        'Upload session not found',
      );
    }

    if (session.status === UploadSessionStatus.EXPIRED) {
      throw new BadRequestException(
        'Upload session has expired',
      );
    }

    // Update file progress
    const file = session.files[data.fileIndex];
    if (!file) {
      throw new BadRequestException(
        'File index not found in session',
      );
    }

    file.status = data.status;
    file.progress = data.progress;
    if (data.error) {
      file.error = data.error;
    }

    // Update session status
    if (session.status === UploadSessionStatus.PENDING) {
      session.status = UploadSessionStatus.IN_PROGRESS;
    }

    await session.save();

    // Note: No SSE notification for progress - frontend already has this data.
    // SSE notifications are only sent for upload_complete and upload_failed events.
  }

  /**
   * Complete bulk upload session
   */
  async completeBulkUpload(
    workspaceId: string,
    userId: string,
    sessionId: string,
  ): Promise<BulkUploadCompleteResponse> {
    const startTime = Date.now();

    const session = await this.uploadSessionModel.findOne({
      _id: sessionId,
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(userId),
    });

    if (!session) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_UPLOAD_SESSION_NOT_FOUND,
        'Upload session not found',
      );
    }

    const successful: { count: number; documents: DocumentResponse[] } = {
      count: 0,
      documents: [],
    };
    const failed: { count: number; files: Array<{ index: number; filename: string; error: string }> } = {
      count: 0,
      files: [],
    };

    // Process each file
    for (const file of session.files) {
      const document = await this.documentModel.findById(file.documentId);

      if (!document) {
        failed.count++;
        failed.files.push({
          index: file.index,
          filename: file.filename,
          error: 'Document record not found',
        });
        continue;
      }

      // Check if blob exists (skip for folders)
      const exists = document.isFolder ? false : document.path ? await this.documentService.exists(document.path) : false;

      if (exists || document.isFolder) {
        // Mark as completed
        document.status = DocumentStatus.COMPLETED;
        document.uploadedAt = new Date();
        document.url = document.path;
        await document.save();

        // Update workspace storage
        await this.workspaceService.updateStorageUsage(workspaceId, document.size, 1);

        successful.count++;
        successful.documents.push(this.mapToResponse(document));
      } else {
        // Clean up any partial blob that might exist (skip for folders)
        try {
          if (!document.isFolder && document.path) {
            await this.documentService.delete(document.path);
          }
        } catch (error) {
          this.logger.warn('Failed to delete orphaned blob during bulk upload completion', {
            sessionId,
            documentId: document._id,
            path: document.path,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        // Delete the failed document record from database
        await this.documentModel.deleteOne({ _id: document._id });

        failed.count++;
        failed.files.push({
          index: file.index,
          filename: file.filename,
          error: file.error || 'File not found in storage',
        });
      }
    }

    // Update session status
    if (failed.count === 0) {
      session.status = UploadSessionStatus.COMPLETED;
    } else if (successful.count === 0) {
      session.status = UploadSessionStatus.FAILED;
    } else {
      session.status = UploadSessionStatus.COMPLETED; // Partial success still marked completed
    }
    session.completedFiles = successful.count;
    session.failedFiles = failed.count;
    await session.save();

    const duration = Date.now() - startTime;

    // Determine overall status
    let status: 'success' | 'partial' | 'failed';
    if (failed.count === 0) {
      status = 'success';
    } else if (successful.count === 0) {
      status = 'failed';
    } else {
      status = 'partial';
    }

    // Send completion notification
    await this.sendUploadNotification(userId, {
      eventType: status === 'failed' ? 'upload_failed' : 'upload_complete',
      sessionId,
      summary: {
        total: session.totalFiles,
        successful: successful.count,
        failed: failed.count,
      },
    });

    this.logger.log('Bulk upload completed', {
      sessionId,
      workspaceId,
      status,
      successful: successful.count,
      failed: failed.count,
      duration,
    });

    return {
      sessionId,
      status,
      totalFiles: session.totalFiles,
      successful,
      failed,
      duration,
    };
  }

  /**
   * Get upload session status
   */
  async getUploadSession(
    workspaceId: string,
    userId: string,
    sessionId: string,
  ): Promise<UploadSessionResponse> {
    const session = await this.uploadSessionModel.findOne({
      _id: sessionId,
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(userId),
    });

    if (!session) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_UPLOAD_SESSION_NOT_FOUND,
        'Upload session not found',
      );
    }

    return this.mapSessionToResponse(session);
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
    } = params;

    const skip = (page - 1) * limit;

    // Build query — default to completed so pending/failed uploads are hidden
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      status: status || DocumentStatus.COMPLETED,
    };

    if (search) {
      query.originalName = { $regex: escapeRegex(search), $options: 'i' };
    }

    // Build sort
    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Execute queries
    const [documents, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments({ ...query, isFolder: false }),
    ]);

    return {
      documents: documents.map((d) => this.mapToResponse(d)),
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
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {
      workspaceId: { $in: workspaceIds.map((id) => new Types.ObjectId(id)) },
      status: status || DocumentStatus.COMPLETED,
    };

    if (search) {
      query.originalName = { $regex: escapeRegex(search), $options: 'i' };
    }

    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    const [documents, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);

    return {
      documents: documents.map((d) => this.mapToResponse(d)),
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

    return this.mapToResponse(document);
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
   * Delete a single document
   */
  async delete(
    workspaceId: string,
    userId: string,
    documentId: string,
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

    // Delete document record
    await this.documentModel.deleteOne({ _id: documentId });

    // Update workspace storage (negative delta)
    if (document.status === DocumentStatus.COMPLETED) {
      await this.workspaceService.updateStorageUsage(workspaceId, -document.size, -1);
    }

    this.logger.log('Document deleted', {
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

    this.logger.log('All documents deleted from workspace', {
      workspaceId,
      count: documents.length,
      indexedCount: indexedDocuments.length,
      storageReclaimed: totalSize,
    });
  }

  /**
   * Cleanup expired upload sessions
   * Runs every 15 minutes to clean up abandoned uploads
   *
   * This handles the case where a user:
   * - Initiates a bulk upload (creates pending documents and session)
   * - Closes the browser/tab before completing
   * - Never calls completeBulkUpload
   *
   * Without cleanup, document records and potentially orphaned blobs
   * would remain indefinitely.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupExpiredSessions(): Promise<void> {
    const startTime = Date.now();

    try {
      // Find expired sessions that are still pending or in progress
      const expiredSessions = await this.uploadSessionModel.find({
        expiresAt: { $lt: new Date() },
        status: { $in: [UploadSessionStatus.PENDING, UploadSessionStatus.IN_PROGRESS] },
      });

      if (expiredSessions.length === 0) {
        return;
      }

      this.logger.log('Starting cleanup of expired upload sessions', {
        count: expiredSessions.length,
      });

      let totalDocumentsDeleted = 0;
      let totalBlobsDeleted = 0;
      let totalSessionsExpired = 0;

      for (const session of expiredSessions) {
        try {
          // Process each file in the session
          for (const file of session.files) {
            const document = await this.documentModel.findById(file.documentId);

            if (!document) {
              continue;
            }

            // Only clean up documents still in PENDING status
            // (documents that were never confirmed)
            if (document.status === DocumentStatus.PENDING && !document.isFolder) {
              // Try to delete the blob from Azure (it may or may not exist)
              try {
                const exists = document.path ? await this.documentService.exists(document.path) : false;
                if (exists) {
                  await this.documentService.delete(document.path!);
                  totalBlobsDeleted++;
                }
              } catch (error) {
                this.logger.warn('Failed to delete orphaned blob during cleanup', {
                  sessionId: session._id,
                  documentId: document._id,
                  path: document.path,
                  error: error instanceof Error ? error.message : 'Unknown error',
                });
              }

              // Delete the document record
              await this.documentModel.deleteOne({ _id: document._id });
              totalDocumentsDeleted++;
            }
          }

          // Mark session as expired
          session.status = UploadSessionStatus.EXPIRED;
          await session.save();
          totalSessionsExpired++;
        } catch (error) {
          this.logger.error('Error cleaning up expired session', {
            sessionId: session._id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const duration = Date.now() - startTime;

      this.logger.log('Expired upload sessions cleanup completed', {
        sessionsExpired: totalSessionsExpired,
        documentsDeleted: totalDocumentsDeleted,
        blobsDeleted: totalBlobsDeleted,
        duration,
      });
    } catch (error) {
      this.logger.error('Failed to cleanup expired upload sessions', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send upload progress notification via SSE
   */
  private async sendUploadNotification(
    userId: string,
    data: UploadProgressNotification,
  ): Promise<void> {
    try {
      let title: string;
      let message: string;
      let type: NotificationType;

      switch (data.eventType) {
        case 'upload_progress':
          title = 'Upload Progress';
          message = `Uploading ${data.filename}: ${data.progress}%`;
          type = NotificationType.INFO;
          break;
        case 'upload_complete':
          if (data.summary) {
            title = 'Upload Complete';
            message = `${data.summary.successful} of ${data.summary.total} files uploaded successfully`;
          } else {
            title = 'Upload Complete';
            message = `${data.filename} uploaded successfully`;
          }
          type = NotificationType.SUCCESS;
          break;
        case 'upload_failed':
          title = 'Upload Failed';
          message = data.error || 'Upload failed';
          if (data.summary) {
            message = `${data.summary.failed} of ${data.summary.total} files failed to upload`;
          }
          type = NotificationType.ERROR;
          break;
        default:
          return;
      }

      await this.notificationsService.sendToUser(userId, {
        type,
        title,
        message,
        data: data as unknown as Record<string, unknown>,
        metadata: {
          sourceModule: 'workspace',
        },
      });
    } catch (error) {
      this.logger.warn('Failed to send upload notification', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
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
    const sanitizedName = this.sanitizeFilename(name);
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
    const folder = await this.documentModel.create({
      filename: '', // Folders don't have files
      originalName: sanitizedName,
      mimeType: 'folder',
      size: 0,
      path: undefined, // Folders don't have physical storage paths
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

    return this.mapToResponse(folder);
  }

  /**
   * Rename a folder
   */
  async renameFolder(folderId: string, newName: string): Promise<DocumentResponse> {
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

    // Validate new name
    const sanitizedName = this.sanitizeFilename(newName);
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
      oldName: folder.originalName,
      newName: sanitizedName,
    });

    return this.mapToResponse(folder);
  }

  /**
   * Delete a folder and all its contents recursively
   */
  async deleteFolder(
    workspaceId: string,
    userId: string,
    folderId: string,
  ): Promise<{ deletedFolders: number; deletedDocuments: number }> {
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

    if (folder.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this folder',
      );
    }

    // Recursively delete all contents
    const result = await this.deleteFolderRecursive(new Types.ObjectId(folderId), workspaceId, userId);

    // Delete the folder itself
    await this.documentModel.deleteOne({ _id: folderId });

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

        deletedDocuments++;
      }

      // Delete item record
      await this.documentModel.deleteOne({ _id: item._id });
    }

    return { deletedFolders, deletedDocuments };
  }

  /**
   * Move documents to a different folder
   */
  async moveDocuments(
    workspaceId: string,
    documentIds: string[],
    targetFolderId?: string,
  ): Promise<{ moved: number; failed: string[] }> {
    const moved: string[] = [];
    const failed: string[] = [];

    for (const documentId of documentIds) {
      try {
        const document = await this.documentModel.findById(documentId);

        if (!document) {
          failed.push(documentId);
          continue;
        }

        if (document.workspaceId.toString() !== workspaceId) {
          failed.push(documentId);
          continue;
        }

        // Cannot move folders with this endpoint (use dedicated move for folders)
        if (document.isFolder) {
          failed.push(documentId);
          continue;
        }

        // Update parent folder
        document.parentId = targetFolderId
          ? new Types.ObjectId(targetFolderId)
          : undefined;
        await document.save();

        moved.push(documentId);
      } catch (error) {
        this.logger.warn('Failed to move document', {
          documentId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        failed.push(documentId);
      }
    }

    this.logger.log('Documents moved', {
      workspaceId,
      targetFolderId,
      movedCount: moved.length,
      failedCount: failed.length,
    });

    return {
      moved: moved.length,
      failed,
    };
  }

  /**
   * Get all documents and folders in a hierarchical structure
   */
  async findAllHierarchical(
    workspaceId: string,
    params: DocumentQueryParams,
  ): Promise<PaginatedDocuments> {
    const {
      page = 1,
      limit = 100,
      status,
      search,
      sortBy = 'originalName',
      sortOrder = 'asc',
    } = params;

    const skip = (page - 1) * limit;

    // Build query
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      status: status || DocumentStatus.COMPLETED,
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
      documents: items.map((d) => this.mapToResponse(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
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
    const [items, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments({ ...query, isFolder: false }),
    ]);

    return {
      documents: items.map((d) => this.mapToResponse(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Map document to response
   */
  private mapToResponse(document: WorkspaceDocumentDoc): DocumentResponse {
    return {
      id: document._id.toString(),
      filename: document.filename,
      originalName: document.originalName,
      mimeType: document.mimeType,
      size: document.size,
      path: document.path,
      url: document.url,
      contentHash: document.contentHash,
      workspaceId: document.workspaceId.toString(),
      createdBy: document.createdBy.toString(),
      status: document.status,
      uploadedAt: document.uploadedAt?.toISOString(),
      errorMessage: document.errorMessage,
      metadata: document.metadata,
      indexingStatus: document.indexingStatus || IndexingStatus.PENDING,
      indexingError: document.indexingError,
      lastIndexedAt: document.lastIndexedAt?.toISOString(),
      detected_language: document.detected_language,
      chunk_size: document.chunk_size,
      parentId: document.parentId?.toString(),
      isFolder: document.isFolder || false,
      folderName: document.folderName,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  /**
   * Map upload session to response
   */
  private mapSessionToResponse(session: UploadSessionDocument): UploadSessionResponse {
    return {
      id: session._id.toString(),
      workspaceId: session.workspaceId.toString(),
      userId: session.userId.toString(),
      status: session.status,
      files: session.files.map((f) => ({
        index: f.index,
        filename: f.filename,
        mimeType: f.mimeType,
        size: f.size,
        documentId: f.documentId?.toString(),
        status: f.status,
        progress: f.progress,
        error: f.error,
      })),
      totalFiles: session.totalFiles,
      totalSize: session.totalSize,
      completedFiles: session.completedFiles,
      failedFiles: session.failedFiles,
      expiresAt: session.expiresAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }
}
