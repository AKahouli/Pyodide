import type { DocumentFilter, DocumentFindOptions } from './document-filter';
import type { WorkspaceDocumentRecord } from './workspace-records';

export const WORKSPACE_DOCUMENT_READ_PORT = Symbol('WORKSPACE_DOCUMENT_READ_PORT');

export interface WorkspaceDocumentReadPort {
  findById(id: string): Promise<WorkspaceDocumentRecord | null>;
  findOne(filter: DocumentFilter): Promise<WorkspaceDocumentRecord | null>;
  find(filter: DocumentFilter, opts?: DocumentFindOptions): Promise<WorkspaceDocumentRecord[]>;
  countDocuments(filter: DocumentFilter): Promise<number>;
  exists(filter: DocumentFilter): Promise<boolean>;
}
