import { Injectable, Inject, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IngestUrlDto } from './dto/ingest-url.dto';
import { IndexingService } from '../indexing/indexing.service';
import { DOCUMENT_STORE, type DocumentStore } from './stores/document-store';
import { UPLOAD_SESSION_STORE, type UploadSessionStore } from './stores/upload-session-store';
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
} from './interfaces/upload-session.interface';
import { WorkspaceService } from './workspace.service';
import { DocumentService } from '../document/document.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LoggerService } from '../logger';
import { WorkspaceUploadSettingsService } from '../system/workspace-upload-settings.service';
import { UrlToPdfClientService } from './services/url-to-pdf-client.service';
import { GuardedUrlDownloaderService } from './services/guarded-url-downloader.service';
import { IntegrationEventOutboxService } from '../integration-events/services/integration-event-outbox.service';
import { WorkspaceArtifactCleanupService } from './services/workspace-artifact-cleanup.service';
import { FeatureVisibilityService } from '../system/feature-visibility.service';
import { WebsiteCrawlerService } from './services/website-crawler.service';
import { WorkspaceDocumentSupport } from './document/document-support';
import { WorkspaceDocumentRead } from './document/document-read';
import { WorkspaceDocumentWrite } from './document/document-write';
import { WorkspaceDocumentLinks } from './document/document-links';
import { WorkspaceDocumentUploadSessions } from './document/document-upload-sessions';
import { WorkspaceDocumentTree } from './document/document-tree';

/**
 * Facade over the WorkspaceDocument collaborators (see ./document/). Keeps the
 * original public surface and constructor so all call sites and specs stay
 * unchanged. The collaborators are constructed here (not injected) because the
 * constructor signature is frozen by existing specs that `new` this class.
 */
@Injectable()
export class WorkspaceDocumentService {
  private readonly support: WorkspaceDocumentSupport;
  private readonly read: WorkspaceDocumentRead;
  private readonly write: WorkspaceDocumentWrite;
  private readonly links: WorkspaceDocumentLinks;
  private readonly uploadSessions: WorkspaceDocumentUploadSessions;
  private readonly tree: WorkspaceDocumentTree;

  constructor(
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    @Inject(UPLOAD_SESSION_STORE) private readonly uploadSessionStore: UploadSessionStore,
    private readonly workspaceService: WorkspaceService,
    private readonly documentService: DocumentService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => IndexingService))
    private readonly indexingService: IndexingService,
    private readonly configService: ConfigService,
    private readonly uploadSettingsService: WorkspaceUploadSettingsService,
    private readonly urlToPdfClient: UrlToPdfClientService,
    private readonly logger: LoggerService,
    private readonly workspaceArtifacts: WorkspaceArtifactCleanupService,
    private readonly websiteCrawler: WebsiteCrawlerService,
    private readonly urlDownloader: GuardedUrlDownloaderService,
    @Optional() private readonly outbox?: IntegrationEventOutboxService,
    @Optional() private readonly featureVisibility?: FeatureVisibilityService,
  ) {
    this.logger.setContext('WorkspaceDocumentService');

    this.support = new WorkspaceDocumentSupport(
      documentStore,
      uploadSettingsService,
      configService,
      notificationsService,
      logger,
      outbox,
      featureVisibility,
    );
    this.read = new WorkspaceDocumentRead(documentStore, documentService, configService, this.support, logger);
    this.write = new WorkspaceDocumentWrite(documentStore, workspaceService, documentService, indexingService, configService, urlDownloader, this.support, logger);
    this.links = new WorkspaceDocumentLinks(documentStore, workspaceService, documentService, indexingService, configService, urlToPdfClient, websiteCrawler, urlDownloader, this.support, logger);
    this.uploadSessions = new WorkspaceDocumentUploadSessions(documentStore, uploadSessionStore, workspaceService, documentService, indexingService, configService, this.support, logger);
    this.tree = new WorkspaceDocumentTree(documentStore, uploadSessionStore, workspaceService, documentService, indexingService, workspaceArtifacts, this.support, logger);
  }

  requestUploadUrlWithPath(
    workspaceId: string,
    userId: string,
    data: RequestUploadUrlData,
    pathPrefix: string,
  ): Promise<UploadUrlResponse> {
    return this.write.requestUploadUrlWithPath(workspaceId, userId, data, pathPrefix);
  }

  uploadSmallFileWithPath(
    workspaceId: string,
    userId: string,
    file: Buffer,
    originalName: string,
    mimeType: string,
    pathPrefix: string,
  ): Promise<DocumentResponse> {
    return this.write.uploadSmallFileWithPath(workspaceId, userId, file, originalName, mimeType, pathPrefix);
  }

  requestUploadUrl(
    workspaceId: string,
    userId: string,
    data: RequestUploadUrlData,
  ): Promise<UploadUrlResponse> {
    return this.write.requestUploadUrl(workspaceId, userId, data);
  }

  confirmUpload(
    workspaceId: string,
    userId: string,
    documentId: string,
    deepSearch?: boolean,
    options?: { autoIndex?: boolean },
  ): Promise<DocumentResponse> {
    return this.write.confirmUpload(workspaceId, userId, documentId, deepSearch, options);
  }

  uploadSmallFile(
    workspaceId: string,
    userId: string,
    file: Buffer,
    originalName: string,
    mimeType: string,
    folderId?: string,
    deepSearch?: boolean,
    autoIndex: boolean = true,
  ): Promise<DocumentResponse> {
    return this.write.uploadSmallFile(workspaceId, userId, file, originalName, mimeType, folderId, deepSearch, autoIndex);
  }

  ingestFromUrl(workspaceId: string, dto: IngestUrlDto): Promise<DocumentResponse> {
    return this.write.ingestFromUrl(workspaceId, dto);
  }

  createFromAiArtifact(
    systemWorkspaceId: string,
    fileInfo: { id: string; name: string; content_type: string; path: string },
  ): Promise<void> {
    return this.write.createFromAiArtifact(systemWorkspaceId, fileInfo);
  }

  renameDocument(workspaceId: string, documentId: string, newName: string): Promise<DocumentResponse> {
    return this.write.renameDocument(workspaceId, documentId, newName);
  }

  moveDocuments(
    workspaceId: string,
    documentIds: string[],
    targetFolderId?: string,
    userId?: string,
  ): Promise<{ moved: number; failed: string[] }> {
    return this.write.moveDocuments(workspaceId, documentIds, targetFolderId, userId);
  }

  addLink(
    workspaceId: string,
    userId: string,
    url: string,
    options?: { deepSearch?: boolean; autoIndex?: boolean },
  ): Promise<DocumentResponse> {
    return this.links.addLink(workspaceId, userId, url, options);
  }

  addLinks(
    workspaceId: string,
    userId: string,
    urls: string[],
    options?: { deepSearch?: boolean; autoIndex?: boolean; sourceRootUrl?: string; names?: Record<string, string>; roots?: Record<string, string>; sourceGroupId?: string },
  ): Promise<DocumentResponse[]> {
    return this.links.addLinks(workspaceId, userId, urls, options);
  }

  crawlSite(_workspaceId: string, url: string): Promise<{ pages: Array<{ url: string; title?: string }>; truncated: boolean }> {
    return this.links.crawlSite(_workspaceId, url);
  }

  checkUrlReachable(url: string): Promise<{ reachable: boolean; status?: number; error?: string }> {
    return this.links.checkUrlReachable(url);
  }

  checkUrls(workspaceId: string, urls: string[]): Promise<{ results: Array<Record<string, unknown>> }> {
    return this.read.checkUrls(workspaceId, urls);
  }

  initiateBulkUpload(
    workspaceId: string,
    userId: string,
    data: InitiateBulkUploadData,
  ): Promise<BulkUploadInitResponse> {
    return this.uploadSessions.initiateBulkUpload(workspaceId, userId, data);
  }

  reportProgress(
    workspaceId: string,
    userId: string,
    sessionId: string,
    data: ReportProgressData,
  ): Promise<void> {
    return this.uploadSessions.reportProgress(workspaceId, userId, sessionId, data);
  }

  completeBulkUpload(
    workspaceId: string,
    userId: string,
    sessionId: string,
    deepSearch?: boolean,
    autoIndex: boolean = true,
  ): Promise<BulkUploadCompleteResponse> {
    return this.uploadSessions.completeBulkUpload(workspaceId, userId, sessionId, deepSearch, autoIndex);
  }

  getUploadSession(workspaceId: string, userId: string, sessionId: string): Promise<UploadSessionResponse> {
    return this.uploadSessions.getUploadSession(workspaceId, userId, sessionId);
  }

  findByIds(documentIds: string[]): Promise<DocumentResponse[]> {
    return this.read.findByIds(documentIds);
  }

  findByIdsInWorkspace(workspaceId: string, documentIds: string[]): Promise<DocumentResponse[]> {
    return this.read.findByIdsInWorkspace(workspaceId, documentIds);
  }

  mergeMetadata(workspaceId: string, documentId: string, patch: Record<string, string>): Promise<void> {
    return this.read.mergeMetadata(workspaceId, documentId, patch);
  }

  generateReadUrl(path: string, options?: { allowExtensionless?: boolean }): Promise<string> {
    return this.read.generateReadUrl(path, options);
  }

  listAllInWorkspace(workspaceId: string): Promise<DocumentResponse[]> {
    return this.read.listAllInWorkspace(workspaceId);
  }

  findAllByWorkspace(workspaceId: string, params: DocumentQueryParams): Promise<PaginatedDocuments> {
    return this.read.findAllByWorkspace(workspaceId, params);
  }

  findByMultipleWorkspaces(workspaceIds: string[], params: DocumentQueryParams): Promise<PaginatedDocuments> {
    return this.read.findByMultipleWorkspaces(workspaceIds, params);
  }

  findById(workspaceId: string, documentId: string): Promise<DocumentResponse> {
    return this.read.findById(workspaceId, documentId);
  }

  getDownloadUrl(workspaceId: string, documentId: string): Promise<DownloadUrlResponse> {
    return this.read.getDownloadUrl(workspaceId, documentId);
  }

  findAllSorted(workspaceId: string, params: DocumentQueryParams): Promise<PaginatedDocuments> {
    return this.read.findAllSorted(workspaceId, params);
  }

  getAllFolders(workspaceId: string): Promise<DocumentResponse[]> {
    return this.read.getAllFolders(workspaceId);
  }

  getFolderContents(workspaceId: string, folderId: string, params: DocumentQueryParams): Promise<PaginatedDocuments> {
    return this.read.getFolderContents(workspaceId, folderId, params);
  }

  createFolder(workspaceId: string, userId: string, name: string, parentId?: string): Promise<DocumentResponse> {
    return this.tree.createFolder(workspaceId, userId, name, parentId);
  }

  renameFolder(folderId: string, newName: string, userId: string): Promise<DocumentResponse> {
    return this.tree.renameFolder(folderId, newName, userId);
  }

  deleteFolder(
    workspaceId: string,
    userId: string,
    folderId: string,
  ): Promise<{ deletedFolders: number; deletedDocuments: number }> {
    return this.tree.deleteFolder(workspaceId, userId, folderId);
  }

  delete(workspaceId: string, userId: string, documentId: string, cascadeArtifacts = false): Promise<void> {
    return this.tree.delete(workspaceId, userId, documentId, cascadeArtifacts);
  }

  bulkDelete(workspaceId: string, userId: string, documentIds: string[]): Promise<BulkDeleteResult> {
    return this.tree.bulkDelete(workspaceId, userId, documentIds);
  }

  deleteAllByWorkspace(workspaceId: string): Promise<void> {
    return this.tree.deleteAllByWorkspace(workspaceId);
  }

  cleanupExpiredSessions(): Promise<void> {
    return this.uploadSessions.cleanupExpiredSessions();
  }
}
