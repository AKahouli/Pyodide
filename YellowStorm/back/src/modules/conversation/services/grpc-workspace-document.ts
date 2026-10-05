import type { IGrpcWorkspaceContext } from '../../agent/interfaces/agent.interface';
import type { DocumentResponse } from '../../workspace/interfaces/workspace-document.interface';

export function toGrpcWorkspaceDocument(doc: DocumentResponse, workspaceId: string, workspaceName: string): IGrpcWorkspaceContext['workspace_documents'][number] {
  return {
    _id: doc.id,
    filename: doc.filename || '',
    filepath: doc.path || '',
    in_memory: false,
    language: doc.detected_language || 'fr',
    indexing_token: doc.chunk_size || 1200,
    workspace_id: workspaceId,
    workspace_name: workspaceName,
    file_name: doc.filename || '',
    createdAt: doc.createdAt,
  };
}
