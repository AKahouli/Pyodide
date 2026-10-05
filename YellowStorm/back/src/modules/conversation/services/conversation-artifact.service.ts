import { Injectable } from '@nestjs/common';
import { DocumentService } from '../../document/document.service';
import { NotFoundException, ServiceUnavailableException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { ResolveCitationUrlDto } from '../dto/resolve-citation-url.dto';
import { RootEvidenceService } from '../root-work/root-evidence.service';

@Injectable()
export class ConversationArtifactService {
  constructor(
    private readonly messageService: MessageService,
    private readonly documentService: DocumentService,
    private readonly conversationService: ConversationService,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly rootEvidence?: RootEvidenceService,
  ) {}

  async listRecent(userId: string, limit: number): Promise<{
    source: 'conversation';
    artifactId: string;
    filename: string;
    artifactKind?: string;
    mimeType?: string;
    conversationId: string;
    conversationTitle: string;
    messageId: string;
    generatedAt: string;
  }[]> {
    const messages = await this.messageService.listRecentArtifactMessages(userId, Math.max(limit * 3, 12));
    return messages.flatMap((message) => (message.components ?? [])
      .filter((component) => component.type === 'artifact')
      .map((component) => ({
        source: 'conversation' as const,
        artifactId: typeof component.data?.artifactId === 'string' ? component.data.artifactId : '',
        filename: typeof component.data?.filename === 'string' ? component.data.filename : 'artifact',
        artifactKind: typeof component.data?.artifactKind === 'string' ? component.data.artifactKind : undefined,
        mimeType: typeof component.data?.mimeType === 'string' ? component.data.mimeType : undefined,
        conversationId: message.conversationId,
        conversationTitle: message.conversationTitle,
        messageId: message.id,
        generatedAt: message.updatedAt.toISOString(),
      })))
      .filter((artifact) => artifact.artifactId)
      .slice(0, limit);
  }

  async resolveDownloadUrl(
    conversationId: string,
    messageId: string,
    artifactId: string,
    userId?: string,
  ): Promise<{ viewUrl: string; downloadUrl: string }> {
    const message = await this.messageService.getMessageDocument(messageId);
    if (message.conversationId.toString() !== conversationId) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }
    const component = message.components?.find((candidate) =>
      candidate.type === 'artifact' && candidate.data?.artifactId === artifactId,
    );
    if (component?.data?.evidenceId || component?.data?.executionId) {
      if (!this.rootEvidence || !userId || typeof component.data.evidenceId !== 'string'
        || typeof component.data.executionId !== 'string') {
        throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Artifact not found');
      }
      const location = await this.rootEvidence.resolve(conversationId, component.data.executionId, component.data.evidenceId, userId);
      if (location.kind !== 'artifact') throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Artifact not found');
      return { viewUrl: location.url, downloadUrl: location.url };
    }
    const storagePath = component?.data?.storagePath;
    if (!component || typeof storagePath !== 'string' || !storagePath) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Artifact not found');
    }
    if (!this.documentService.isAvailable()) {
      throw new ServiceUnavailableException(undefined, 'Document service is currently unavailable');
    }
    const filename = typeof component.data.filename === 'string' ? component.data.filename : 'artifact';
    const [viewUrl, downloadUrl] = await Promise.all([
      this.documentService.generateSasUrl(storagePath, {
        expiryMinutes: 10,
        checkExists: true,
      }),
      this.documentService.generateSasUrl(storagePath, {
        expiryMinutes: 10,
        contentDisposition: `attachment; filename="${filename.replace(/["\r\n]/g, '')}"`,
        checkExists: true,
      }),
    ]);
    return { viewUrl, downloadUrl };
  }

  async resolveCitationUrl(
    conversationId: string,
    messageId: string,
    selector: ResolveCitationUrlDto,
    userId?: string,
  ): Promise<{ url: string; fileName: string; mimeType: string }> {
    const message = await this.messageService.getMessageDocument(messageId);
    if (message.conversationId.toString() !== conversationId) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation not found');
    }

    const ownedCitations = (message.components ?? []).filter((component) => component.type === 'citation'
      && (component.data.evidenceId || component.data.executionId)).filter((component) => {
        const citation = this.getCitationIdentity(component.data);
        return (selector.fileName ? citation.fileName === selector.fileName : citation.source === selector.source)
          && (!selector.reference || citation.reference === this.normalizeReference(selector.reference));
      });
    if (ownedCitations.length) {
      const component = ownedCitations[0];
      if (ownedCitations.length !== 1 || !this.rootEvidence || !userId
        || typeof component.data.evidenceId !== 'string' || typeof component.data.executionId !== 'string') {
        throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation not found');
      }
      const location = await this.rootEvidence.resolve(conversationId, component.data.executionId, component.data.evidenceId, userId);
      if (location.kind !== 'citation') throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation not found');
      return { url: location.url, fileName: location.fileName, mimeType: location.mimeType || 'application/octet-stream' };
    }

    const citationCandidates = message.components
      ?.filter((component) => component.type === 'citation')
      .map((component) => this.getCitationIdentity(component.data))
      .filter((citation) => selector.fileName
        ? citation.fileName === selector.fileName
        : citation.source === selector.source)
      .filter((citation) => !selector.reference || citation.reference === this.normalizeReference(selector.reference)) || [];
    const uniqueCitations = new Map(
      citationCandidates.map((citation) => [
        `${citation.source}\u0000${citation.fileName || ''}\u0000${citation.workspaceId || ''}`,
        citation,
      ]),
    );
    if (uniqueCitations.size !== 1) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation not found');
    }
    const persistedCitation = [...uniqueCitations.values()][0];

    const conversation = await this.conversationService.getConversationDocument(conversationId);
    const allowedWorkspaceIds = new Set(
      await this.conversationService.filterAccessibleWorkspaceIds(
        userId,
        (conversation.workspaces || []).map((id) => id.toString()),
      ),
    );
    if (conversation.systemWorkspaceId) {
      allowedWorkspaceIds.add(conversation.systemWorkspaceId.toString());
    }
    if (persistedCitation.workspaceId && !allowedWorkspaceIds.has(persistedCitation.workspaceId)) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation document not found');
    }
    if (persistedCitation.workspaceId) {
      allowedWorkspaceIds.clear();
      allowedWorkspaceIds.add(persistedCitation.workspaceId);
    }

    const fileName = persistedCitation.fileName || persistedCitation.source.split('/').pop();
    if (!fileName || allowedWorkspaceIds.size === 0) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation document not found');
    }
    const result = await this.workspaceDocumentService.findByMultipleWorkspaces(
      [...allowedWorkspaceIds],
      { search: fileName, page: 1, limit: 100, searchFilename: true },
    );
    const matches = result.documents.filter((document) =>
      !document.isFolder && document.path &&
      (document.originalName === fileName || document.filename === fileName),
    );
    if (matches.length !== 1 || result.pagination.total > result.documents.length) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Citation document not found');
    }
    if (!this.documentService.isAvailable()) {
      throw new ServiceUnavailableException(undefined, 'Document service is currently unavailable');
    }

    const document = matches[0];
    const url = await this.documentService.generateSasUrl(document.path!, {
      expiryMinutes: 10,
      checkExists: true,
    });
    return { url, fileName: document.originalName, mimeType: document.mimeType };
  }

  private getCitationIdentity(data: Record<string, unknown>): {
    source: string;
    fileName?: string;
    workspaceId?: string;
    reference?: string;
  } {
    const textSource = data.text_source as Record<string, unknown> | undefined;
    const imageSource = data.image_source as Record<string, unknown> | undefined;
    const sourceData = textSource || imageSource || data;
    const sourceType = data.sourceType ?? data.source_type;
    const isImageSource = Boolean(imageSource) || sourceType === 'image';
    const value = (key: string, snakeKey: string): string | undefined => {
      const candidate = sourceData[key] ?? sourceData[snakeKey];
      return typeof candidate === 'string' && candidate ? candidate : undefined;
    };
    return {
      source: (isImageSource ? value('path', 'path') : value('source', 'source')) || '',
      fileName: value('fileName', 'file_name') || (isImageSource ? value('source', 'source') : undefined),
      workspaceId: value('workspaceId', 'workspace_id'),
      reference: this.normalizeReference(value('reference', 'reference')),
    };
  }

  private normalizeReference(reference?: string): string | undefined {
    return reference?.trim().replace(/^\[|\]$/g, '').trim() || undefined;
  }
}
