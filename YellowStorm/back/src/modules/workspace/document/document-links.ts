import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { newObjectId } from '@common/postgres';
import type { WorkspaceDocumentRecord } from '../ports/workspace-records';
import { DocumentStatus, DocumentType, IndexingStatus } from '../interfaces/document-status.enum';
import { DOCUMENT_STORE, type DocumentStore } from '../stores/document-store';
import { IndexingService } from '../../indexing/indexing.service';
import { DocumentResponse } from '../interfaces/workspace-document.interface';
import { WorkspaceService } from '../workspace.service';
import { DocumentService } from '../../document/document.service';
import { LoggerService } from '../../logger';
import { ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { UrlToPdfClientService } from '../services/url-to-pdf-client.service';
import { normalizeWorkspaceUrl } from '../services/url-normalization';
import { GuardedUrlDownloaderService } from '../services/guarded-url-downloader.service';
import { WorkspaceIntegrationEvents } from '../../integration-events/contracts';
import { WebsiteCrawlerService } from '../services/website-crawler.service';
import { WorkspaceDocumentSupport, isUniqueDocumentNameViolation } from './document-support';

@Injectable()
export class WorkspaceDocumentLinks {
  constructor(
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    private readonly workspaceService: WorkspaceService,
    private readonly documentService: DocumentService,
    @Inject(forwardRef(() => IndexingService))
    private readonly indexingService: IndexingService,
    private readonly configService: ConfigService,
    private readonly urlToPdfClient: UrlToPdfClientService,
    private readonly websiteCrawler: WebsiteCrawlerService,
    private readonly urlDownloader: GuardedUrlDownloaderService,
    private readonly support: WorkspaceDocumentSupport,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkspaceDocumentLinks');
  }

  /**
   * Add a website link as a workspace document. Creates the doc immediately in a
   * PROCESSING state and returns it; conversion to PDF + indexing runs in the
   * background (fire-and-forget). The stored artifact is a PDF.
   */
  async addLink(
    workspaceId: string,
    userId: string,
    url: string,
    options?: { deepSearch?: boolean; autoIndex?: boolean },
  ): Promise<DocumentResponse> {
    const [doc] = await this.addLinks(workspaceId, userId, [url], options);
    return doc;
  }

  /**
   * Add multiple website links as workspace documents. Creates each doc
   * immediately in a PROCESSING state and returns them all; conversion to
   * PDF + indexing runs in the background (fire-and-forget) with a bounded
   * concurrency so we don't hammer the conversion service.
   */
  async addLinks(
    workspaceId: string,
    userId: string,
    urls: string[],
    options?: { deepSearch?: boolean; autoIndex?: boolean; sourceRootUrl?: string; names?: Record<string, string>; roots?: Record<string, string>; sourceGroupId?: string },
  ): Promise<DocumentResponse[]> {
    // Nominal size of 0: the converted PDF's size is unknown until conversion
    // runs, but we can still reject early if the workspace is already over
    // quota, avoiding a wasted conversion-API call.
    const quota = await this.workspaceService.checkStorageQuota(workspaceId, 0);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB`,
      );
    }

    // One group per index batch: reuse the caller's id (continue mode) or mint a
    // fresh one, so two separate sessions on the same URL form two distinct groups.
    const groupId = options?.sourceGroupId ?? newObjectId();

    // Create all docs first (fast; each PROCESSING with a unique placeholder path).
    const created: { response: DocumentResponse; id: string; url: string; name: string; nameFromUrl: boolean }[] =
      [];
    for (const url of urls) {
      // Prefer the clicked link/button text (the same label shown in the browse
      // sidebar) as the document name; fall back to the URL-derived filename when
      // the page carried no link text. When we fall back, `nameFromUrl` lets the
      // background conversion try the real page <title> before settling for the URL.
      const providedName = options?.names?.[url]?.replace(/\s+/g, ' ').trim();
      const nameFromUrl = !providedName;
      const filename = this.support.ensurePdfExtension(
        providedName ? providedName.slice(0, 200) : this.support.deriveFilenameFromUrl(url),
      );
      const root = options?.roots?.[url] ?? options?.sourceRootUrl;
      const documentId = newObjectId();

      let effectiveName = filename;
      const document = await this.support.createWithUniqueName(workspaceId, filename, (resolvedName) => {
        effectiveName = resolvedName;
        return {
        id: documentId,
        originalName: resolvedName,
        mimeType: 'application/pdf',
        size: 0,
        type: DocumentType.URL,
        sourceUrl: url,
        metadata: {
          deepSearchRequested: String(Boolean(options?.deepSearch)),
          autoIndexRequested: String(options?.autoIndex !== false),
          normalizedSourceUrl: normalizeWorkspaceUrl(url),
          sourceGroupId: groupId,
          ...(root
            ? {
                sourceRootUrl: root,
                normalizedSourceRootUrl: normalizeWorkspaceUrl(root),
              }
            : {}),
        },
        // The collection enforces a unique index on `path`. A link has no blob
        // yet at creation, so assign a unique placeholder (mirroring the folder
        // pattern above) to avoid an E11000 collision on { path: null } between
        // concurrent/successive link adds. convertAndStore overwrites this with
        // the real Ceph blob path once the PDF is uploaded. The `.pdf` suffix
        // keeps the placeholder past the "no extension ⇒ folder" heuristic in
        // DocumentService.generateSasUrl, so a stray read of a not-yet-converted
        // link fails with an accurate "file not found" rather than a misleading
        // "cannot download folders" error.
        path: `link-pending:${documentId}.pdf`,
        workspaceId,
        createdBy: userId,
        status: DocumentStatus.PROCESSING,
        indexingStatus: IndexingStatus.NONE,
        };
      });

      this.logger.debug('Link document created', { documentId: document.id, workspaceId, url });
      await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.WebPageRegisteredV1, document);
      created.push({
        response: this.support.mapToResponse(document),
        id: document.id,
        url,
        name: effectiveName,
        nameFromUrl,
      });
    }

    // Convert strictly one at a time, spaced by a delay, so a rate-limited target
    // (HTTP 429) gets its window to reset between pages instead of being hit in a
    // burst. Fire-and-forget the whole loop; respond as soon as the docs exist.
    const delayMs = this.configService.get<number>('indexing.sequentialDelayMs') ?? 2000;
    void (async () => {
      for (let idx = 0; idx < created.length; idx++) {
        const item = created[idx];
        await this.convertAndStore(item.id, workspaceId, item.url, item.name, item.nameFromUrl, options).catch((err) => {
          this.logger.error('convertAndStore failed', {
            documentId: item.id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        });
        if (idx < created.length - 1 && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    })();

    return created.map((c) => c.response);
  }

  /**
   * Crawl a seed URL and return the discovered pages that live UNDER the seed's
   * path (so "Explore" on /docs yields /docs/*; a root seed yields the whole site).
   */
  async crawlSite(_workspaceId: string, url: string): Promise<{ pages: { url: string; title?: string }[]; truncated: boolean }> {
    const { pages, truncated } = await this.websiteCrawler.crawl(url);
    let seedPath = '/';
    try { seedPath = new URL(url).pathname.replace(/\/+$/, '') || '/'; } catch { /* keep '/' */ }
    const underSeed = (candidate: string): boolean => {
      try {
        const p = new URL(candidate).pathname;
        if (seedPath === '/') return true;
        return p === seedPath || p.startsWith(`${seedPath}/`);
      } catch { return false; }
    };
    return { pages: pages.filter((p) => underSeed(p.url)), truncated };
  }

  /**
   * Check that a URL is reachable (HEAD, falling back to GET). Used by the
   * link modal before the user commits to adding the link.
   */
  async checkUrlReachable(
    url: string,
  ): Promise<{ reachable: boolean; status?: number; error?: string }> {
    return this.urlDownloader.checkUrlReachable(url);
  }

  /**
   * Background step: convert the website to PDF, store it, mark the doc COMPLETED,
   * and queue indexing. On failure, mark the doc FAILED and notify the owner.
   */
  private async convertAndStore(
    documentId: string,
    workspaceId: string,
    url: string,
    filename: string,
    nameFromUrl: boolean,
    options?: { deepSearch?: boolean; autoIndex?: boolean },
  ): Promise<void> {
    try {
      await this.urlDownloader.assertUrlIsSafe(url);

      // The name only came from the URL (no clicked link text / provided title).
      // Try the real page <title> so the doc is named after the page, falling
      // back to the URL-derived name when the page has no usable title.
      let effectiveName = filename;
      let renamedOriginal: string | undefined;
      if (nameFromUrl) {
        const title = (await this.websiteCrawler.fetchTitle(url).catch(() => undefined))
          ?.replace(/\s+/g, ' ')
          .trim();
        if (title) {
          const titleName = this.support.ensurePdfExtension(title.slice(0, 200));
          renamedOriginal = await this.support.resolveUniqueOriginalName(workspaceId, titleName);
          effectiveName = renamedOriginal;
        }
      }

      const pdf = await this.urlToPdfClient.convert(url, effectiveName);
      const size = pdf.length;

      const quota = await this.workspaceService.checkStorageQuota(workspaceId, size);
      if (!quota.allowed) {
        throw new Error('Insufficient storage for converted PDF');
      }

      const { ownerUserId, storagePrefix } = await this.workspaceService.getStorageContext(
        workspaceId,
      );
      const sanitizedName = this.support.sanitizeFilename(effectiveName);
      const uploaded = await this.documentService.upload(pdf, effectiveName, 'application/pdf', {
        folder: `${ownerUserId}/${storagePrefix}`,
        generateUniqueName: false,
        customFileName: sanitizedName,
      });

      const completion = {
        filename: uploaded.storedName,
        path: uploaded.blobPath,
        url: uploaded.url,
        contentHash: uploaded.contentHash,
        size,
        status: DocumentStatus.COMPLETED,
        uploadedAt: new Date(),
      };
      let completed;
      try {
        completed = await this.documentStore.updateById(documentId, {
          ...completion,
          // Only when we resolved a real page title (else keep the URL-derived name).
          ...(renamedOriginal ? { originalName: renamedOriginal } : {}),
        });
      } catch (error) {
        // A concurrent upload took the page-title name: keep the URL-derived one.
        if (!renamedOriginal || !isUniqueDocumentNameViolation(error)) throw error;
        completed = await this.documentStore.updateById(documentId, completion);
      }

      if (completed) {
        await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentRegisteredV1, completed);
        await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.ArtifactReadyV1, completed);
      }

      await this.workspaceService.updateStorageUsage(workspaceId, size, 1);
      if (options?.autoIndex !== false) {
        await this.indexingService.queueDocument(documentId, options?.deepSearch);
      }

      this.logger.debug('Link converted and stored', { documentId, workspaceId, size });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Link conversion failed';
      const failed = await this.documentStore.updateById(
        documentId,
        {
          status: DocumentStatus.FAILED,
          indexingStatus: IndexingStatus.FAILED,
          errorMessage: message,
          indexingError: message,
        },
      );
      if (failed) {
        await this.indexingService.sendIndexingStatusNotification({
          ...JSON.parse(JSON.stringify(failed)),
          id: failed.id,
        } as WorkspaceDocumentRecord).catch(() => undefined);
      }
      this.logger.error('Link conversion failed', { documentId, workspaceId, error: message });
    }
  }
}
