import { Injectable } from '@nestjs/common';
import { NotFoundException, ErrorCode } from '../../exceptions';
import { DocumentService } from '../../document/document.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { ConversationService } from '../services/conversation.service';
import { RootResultService } from './root-result.service';
import { RootWorkService } from './root-work.service';

function sourceIdentity(payload: Record<string, unknown>): Record<string, unknown> {
  const source = payload.source_object as Record<string, unknown> | undefined;
  return { ...payload, ...(source ?? {}), ...(source?.metadata as object ?? {}), ...(source?.content as object ?? {}) };
}
const text = (value: unknown) => typeof value === 'string' ? value : '';

@Injectable()
export class RootEvidenceService {
  constructor(private readonly results: RootResultService, private readonly work: RootWorkService,
    private readonly conversations: ConversationService, private readonly documents: WorkspaceDocumentService,
    private readonly storage: DocumentService) {}

  async resolve(conversationId: string, executionId: string, evidenceId: string, actorId: string) {
    const execution = await this.results.authorizeResult(conversationId, executionId, actorId);
    const registered = (await this.work.listEvidenceForExecution(executionId)).find((item) => item.id === evidenceId);
    if (!registered || registered.executionId !== executionId || registered.conversationId !== conversationId
      || registered.producerAgentId !== execution.resultPayload?.producerAgentId
      || ![...execution.resultPayload.citationRefs, ...execution.resultPayload.artifactRefs].includes(evidenceId)) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Evidence is unavailable');
    }
    const source = sourceIdentity(registered.payload);
    const workspaceId = text(source.workspace_id || source.workspaceId || source.brain_id);
    const documentId = text(source.document_id || source.documentId);
    const filename = text(source.filename || source.file_name || source.fileName);
    const storagePath = text(source.file_path || source.filepath || source.path);
    let url = '';
    let fileName = filename;
    if (workspaceId) {
      const allowed = await this.conversations.filterAccessibleWorkspaceIds(actorId, [workspaceId]);
      if (!allowed.includes(workspaceId)) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Source access is unavailable');
      const page = documentId ? null : await this.documents.findByMultipleWorkspaces([workspaceId],
        { search: filename, page: 1, limit: 100, searchFilename: true });
      if (page && page.pagination.total > page.documents.length) {
        throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Source document is ambiguous');
      }
      const matches = documentId ? [await this.documents.findById(workspaceId, documentId)]
        : page!.documents.filter((document) => !document.isFolder && document.path
          && (document.originalName === filename || document.filename === filename));
      if (matches.length !== 1 || matches[0].isFolder || !matches[0].path || storagePath && matches[0].path !== storagePath) {
        throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Source document is unavailable');
      }
      fileName = matches[0].originalName;
      url = await this.storage.generateSasUrl(matches[0].path!, { expiryMinutes: 10, checkExists: true });
    } else if (registered.kind === 'artifact' && storagePath) {
      // Native run-code output belongs to this exact child, never its siblings.
      const prefix = `${actorId}/system_${executionId}/`;
      if (!storagePath.startsWith(prefix) || storagePath.includes('\\')
        || storagePath.split('/').some((part) => !part || part === '..' || part === '.')) {
        throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Artifact path is unavailable');
      }
      url = await this.storage.generateSasUrl(storagePath, { expiryMinutes: 10, checkExists: true });
    } else if (registered.kind === 'citation') {
      try {
        const candidate = new URL(text(source.url || source.source));
        if (!['http:', 'https:'].includes(candidate.protocol) || candidate.username || candidate.password) throw new Error('invalid source');
        candidate.search = ''; candidate.hash = '';
        url = candidate.toString();
      } catch {
        throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Source location is unavailable');
      }
    }
    if (!url) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Evidence location is unavailable');
    // Recheck execution and source grants after asynchronous storage resolution.
    await this.results.authorizeResult(conversationId, executionId, actorId);
    if (workspaceId && !(await this.conversations.filterAccessibleWorkspaceIds(actorId, [workspaceId])).includes(workspaceId)) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Source access is unavailable');
    }
    return { evidenceId, kind: registered.kind, producerAgentId: registered.producerAgentId, url, fileName };
  }
}
