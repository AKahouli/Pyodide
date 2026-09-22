import { Injectable } from '@nestjs/common';
import { DocumentStatus, WorkspaceDocumentService, type DocumentResponse } from '../../workspace';
import { ForbiddenException, ErrorCode } from '../../exceptions';
import { LoggerService } from '../../logger';

/**
 * The only attachment resolver Conversation code may use. Resolves attachment
 * IDs strictly inside the conversation's system workspace and fails closed on
 * any ID that does not belong to it — a generic findByIds() would let a client
 * reference another workspace's documents.
 */
@Injectable()
export class ConversationAttachmentResolverService {
  constructor(
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('ConversationAttachmentResolverService');
  }

  /**
   * Deduplicate, verify ownership inside `systemWorkspaceId`, and keep only
   * COMPLETED documents. Any ID outside the workspace aborts the whole
   * resolution (fail closed) instead of being silently dropped.
   */
  async resolve(systemWorkspaceId: string, documentIds: string[]): Promise<DocumentResponse[]> {
    const uniqueIds = [...new Set(documentIds)];
    if (uniqueIds.length === 0) return [];

    const documents = await this.workspaceDocumentService.findByIdsInWorkspace(
      systemWorkspaceId,
      uniqueIds,
    );

    const foundById = new Map(documents.map((document) => [document.id, document]));
    const missing = uniqueIds.filter((id) => !foundById.has(id));
    if (missing.length > 0) {
      throw new ForbiddenException(
        ErrorCode.CHAT_FORBIDDEN,
        'Message references files outside this conversation',
      );
    }

    return uniqueIds
      .map((id) => foundById.get(id)!)
      .filter((document) => {
        if (document.status === DocumentStatus.COMPLETED && !document.isFolder) return true;
        this.logger.warn('Skipping non-completed conversation attachment', {
          documentId: document.id,
          status: document.status,
        });
        return false;
      });
  }
}
