import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { DocumentResponse } from '../../workspace';
import { DocumentService } from '../../document/document.service';
import { IndexingService } from '../../indexing/indexing.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { LoggerService } from '../../logger';
import type {
  AttachmentTextProfileV1,
  ConversationAttachmentPolicy,
  PreparedConversationAttachment,
} from '../interfaces/conversation-attachment.interface';
import {
  ATTACHMENT_POLICY_METADATA_KEY,
  ATTACHMENT_PROFILE_PATH_METADATA_KEY,
} from '../interfaces/conversation-attachment.interface';

const PROFILE_TIMEOUT_MS = 15_000;
const TABULAR_EXTENSIONS = ['.csv', '.xls', '.xlsx'];

export function isTabularAttachment(filename: string, mimeType: string): boolean {
  const extension = filename.toLowerCase().replace(/.*(\.[^.]+)$/, '$1');
  return TABULAR_EXTENSIONS.includes(extension) || /spreadsheetml|msexcel|csv/.test(mimeType);
}

/**
 * Decides the per-file attachment policy and produces the text profile used
 * for prompt context. Extraction and tabular row counting are delegated to the
 * ADK attachment-profile service; NestJS owns the final policy decision and
 * the search-indexing gate so heavy spreadsheets can never be indexed.
 */
@Injectable()
export class ConversationAttachmentService {
  constructor(
    private readonly configService: ConfigService,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly documentService: DocumentService,
    private readonly indexingService: IndexingService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('ConversationAttachmentService');
  }

  /**
   * Idempotent: a document whose policy was already persisted is reused
   * (profile reloaded from its sidecar) instead of re-extracted. Safe under
   * concurrent calls: the sidecar write is a deterministic-key overwrite with
   * identical content.
   */
  async prepareAttachments(
    userId: string,
    conversationId: string,
    documents: DocumentResponse[],
    maxIndexedTabularRows: number,
  ): Promise<PreparedConversationAttachment[]> {
    return Promise.all(
      documents.map((document) =>
        this.prepareOne(userId, conversationId, document, maxIndexedTabularRows).catch((error) => {
          this.logger.error('conversation_attachment_profile_failed', {
            documentId: document.id,
            error: (error as Error).message,
          });
          return this.fallbackPrepared(document);
        }),
      ),
    );
  }

  private async prepareOne(
    userId: string,
    conversationId: string,
    document: DocumentResponse,
    maxIndexedTabularRows: number,
  ): Promise<PreparedConversationAttachment> {
    const tabular = isTabularAttachment(document.originalName, document.mimeType);

    const cachedPolicy = document.metadata?.[ATTACHMENT_POLICY_METADATA_KEY] as
      | ConversationAttachmentPolicy
      | undefined;
    const cachedProfilePath = document.metadata?.[ATTACHMENT_PROFILE_PATH_METADATA_KEY];
    if (cachedPolicy) {
      const profile = cachedProfilePath ? await this.readProfile(cachedProfilePath, document.id) : undefined;
      return this.toPrepared(document, cachedPolicy, profile, cachedProfilePath, false);
    }

    this.logger.log('conversation_attachment_prepare_started', {
      documentId: document.id,
      conversationId,
    });

    let profile: AttachmentTextProfileV1 | undefined;
    try {
      profile = await this.requestProfile(document, maxIndexedTabularRows);
    } catch (error) {
      // Fail closed: without a reliable row count a tabular file is never indexed.
      if (tabular) {
        this.logger.warn('conversation_attachment_policy_selected', {
          documentId: document.id,
          policy: 'CODE_ONLY',
          reason: 'profile_probe_failed',
        });
        return this.finish(document, 'CODE_ONLY', undefined, userId, conversationId);
      }
      this.logger.warn('conversation_attachment_profile_failed', {
        documentId: document.id,
        error: (error as Error).message,
      });
      return this.finish(document, 'TEXT_ONLY', undefined, userId, conversationId);
    }

    const totalRows = profile.tabular?.totalRows;
    const policy: ConversationAttachmentPolicy = tabular
      ? (totalRows !== undefined && totalRows <= maxIndexedTabularRows ? 'SEARCHABLE' : 'CODE_ONLY')
      : (profile.extraction.status === 'failed' ? 'TEXT_ONLY' : 'SEARCHABLE');

    this.logger.log('conversation_attachment_policy_selected', {
      documentId: document.id,
      policy,
      totalRows,
    });
    return this.finish(document, policy, profile, userId, conversationId);
  }

  /** Persist the policy, store the profile sidecar, and queue search indexing when allowed. */
  private async finish(
    document: DocumentResponse,
    policy: ConversationAttachmentPolicy,
    profile: AttachmentTextProfileV1 | undefined,
    userId: string,
    conversationId: string,
  ): Promise<PreparedConversationAttachment> {
    const searchIndexAllowed = policy === 'SEARCHABLE';
    const sidecarPath = `${userId}/${conversationId}/.attachment-context/${document.id}/profile-v1.json`;

    let profilePath: string | undefined;
    if (profile) {
      try {
        await this.documentService.upload(
          Buffer.from(JSON.stringify(profile), 'utf8'),
          'profile-v1.json',
          'application/json',
          {
            folder: `${userId}/${conversationId}/.attachment-context/${document.id}`,
            generateUniqueName: false,
            customFileName: 'profile-v1.json',
          },
        );
        profilePath = sidecarPath;
      } catch (error) {
        this.logger.warn('Attachment profile sidecar upload failed; policy kept in metadata', {
          documentId: document.id,
          error: (error as Error).message,
        });
      }
    }

    try {
      await this.workspaceDocumentService.mergeMetadata(document.workspaceId, document.id, {
        [ATTACHMENT_POLICY_METADATA_KEY]: policy,
        ...(profilePath ? { [ATTACHMENT_PROFILE_PATH_METADATA_KEY]: profilePath } : {}),
      });
    } catch (error) {
      this.logger.warn('Attachment policy persistence failed', {
        documentId: document.id,
        error: (error as Error).message,
      });
    }

    if (searchIndexAllowed) {
      this.logger.log('conversation_attachment_search_queued', { documentId: document.id });
      this.indexingService.queueDocument(document.id).catch((error) => {
        this.logger.warn('conversation_attachment_search_blocked', {
          documentId: document.id,
          error: (error as Error).message,
        });
      });
    }

    return this.toPrepared(document, policy, profile, profilePath, searchIndexAllowed);
  }

  /** Policy recommendation is computed here from the profile; ADK only extracts. */
  private async requestProfile(
    document: DocumentResponse,
    maxIndexedTabularRows: number,
  ): Promise<AttachmentTextProfileV1> {
    const adkUrl = (this.configService.get<string>('indexing.apiAdk') || 'http://localhost:8001').replace(/\/$/, '');
    const apiKey = this.configService.get<string>('indexing.adkApiKey') || '';
    const { data } = await axios.post<AttachmentTextProfileV1>(
      `${adkUrl}/vectorstores/attachmentProfile`,
      {
        document_id: document.id,
        path: document.path,
        filename: document.originalName,
        mime_type: document.mimeType,
        max_indexed_tabular_rows: maxIndexedTabularRows,
      },
      {
        timeout: PROFILE_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
      },
    );
    return data;
  }

  private async readProfile(profilePath: string, documentId: string): Promise<AttachmentTextProfileV1 | undefined> {
    try {
      const buffer = await this.documentService.download(profilePath);
      return JSON.parse(buffer.toString('utf8')) as AttachmentTextProfileV1;
    } catch (error) {
      this.logger.warn('Attachment profile sidecar unreadable; will re-extract', {
        documentId,
        error: (error as Error).message,
      });
      return undefined;
    }
  }

  private toPrepared(
    document: DocumentResponse,
    policy: ConversationAttachmentPolicy,
    profile: AttachmentTextProfileV1 | undefined,
    profilePath: string | undefined,
    searchIndexAllowed: boolean,
  ): PreparedConversationAttachment {
    return {
      documentId: document.id,
      workspaceId: document.workspaceId,
      filename: document.originalName,
      mimeType: document.mimeType,
      sizeBytes: document.size,
      policy,
      rowCount: profile?.tabular?.totalRows,
      sheetCount: profile?.tabular?.sheetCount,
      profilePath: profilePath ?? undefined,
      searchIndexAllowed,
      profile,
    };
  }

  /** Best-effort removal of the attachment profile sidecar (idempotent). */
  async deleteProfileSidecar(userId: string, conversationId: string, documentId: string): Promise<void> {
    const sidecarPath = `${userId}/${conversationId}/.attachment-context/${documentId}/profile-v1.json`;
    try {
      await this.documentService.delete(sidecarPath);
    } catch (error) {
      this.logger.debug('Attachment profile sidecar delete skipped', {
        documentId,
        error: (error as Error).message,
      });
    }
  }

  /** Last-resort prepared attachment: metadata only, code access, never indexed. */
  private fallbackPrepared(document: DocumentResponse): PreparedConversationAttachment {
    return this.toPrepared(document, 'TEXT_ONLY', undefined, undefined, false);
  }
}
