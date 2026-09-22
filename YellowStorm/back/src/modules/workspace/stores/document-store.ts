import type { WorkspaceDocumentRecord } from '../ports/workspace-records';

export const DOCUMENT_STORE = Symbol('DOCUMENT_STORE');

export interface DocumentCreateInput {
  id?: string;
  filename?: string;
  originalName: string;
  mimeType: string;
  size: number;
  path?: string;
  url?: string;
  contentHash?: string;
  workspaceId: string;
  createdBy: string;
  status: string;
  uploadedAt?: Date;
  indexingStatus?: string;
  parentId?: string | null;
  isFolder?: boolean;
  folderName?: string;
  type?: string;
  sourceUrl?: string;
  metadata?: Record<string, string>;
}

export interface FolderDuplicateProbe {
  workspaceId: string;
  createdBy: string;
  folderName: string;
  /** null = root level. */
  parentId: string | null;
  excludeId?: string;
}

export interface DocumentListParams {
  status?: string;
  search?: string;
  searchFilename?: boolean;
  skip: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export interface WorkspaceDocumentListParams extends DocumentListParams {
  /** undefined = all levels, null = root level, string = inside folder. */
  parentId?: string | null;
  includeAllStatuses?: boolean;
}

/** Patch for updateById (findByIdAndUpdate $set semantics): only explicitly
 * present keys are written. Returns the updated record, null when absent. */
export type DocumentUpdatePatch = Partial<
  Pick<
    WorkspaceDocumentRecord,
    'filename' | 'originalName' | 'folderName' | 'path' | 'url' | 'contentHash' | 'size' | 'status' | 'errorMessage' | 'metadata' | 'indexingStatus' | 'indexingError'
  >
> & { uploadedAt?: Date };

/**
 * Internal store for workspace documents. Read parity with the Step C read
 * port is intentional duplication of call-site-shaped operations, not of
 * listing queries — those differ (pagination shapes, folder scoping).
 */
export interface DocumentStore {
  create(input: DocumentCreateInput): Promise<WorkspaceDocumentRecord>;
  findById(id: string): Promise<WorkspaceDocumentRecord | null>;
  findByIdAndWorkspace(id: string, workspaceId: string): Promise<WorkspaceDocumentRecord | null>;
  findByIds(ids: string[]): Promise<WorkspaceDocumentRecord[]>;
  findByIdsInWorkspace(workspaceId: string, ids: string[]): Promise<WorkspaceDocumentRecord[]>;
  /** Windows-Explorer-style name probe (files only, isFolder: false). */
  originalNameExists(workspaceId: string, originalName: string): Promise<boolean>;
  findFolderDuplicate(probe: FolderDuplicateProbe): Promise<WorkspaceDocumentRecord | null>;
  /** Direct child folders of `parentId`, id-only (circular-move guard). */
  findChildFolderIds(parentId: string): Promise<string[]>;
  /**
   * Run `fn` in a transaction holding a per-workspace folder-tree lock
   * (serialises cycle-check + move). Store calls inside `fn` join the tx.
   */
  withWorkspaceTreeLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
  findDirectChildren(parentId: string, workspaceId: string): Promise<WorkspaceDocumentRecord[]>;
  findAllByWorkspaceId(workspaceId: string): Promise<WorkspaceDocumentRecord[]>;
  listByWorkspace(workspaceId: string, params: WorkspaceDocumentListParams): Promise<{ items: WorkspaceDocumentRecord[]; total: number }>;
  listByWorkspaces(workspaceIds: string[], params: DocumentListParams): Promise<{ items: WorkspaceDocumentRecord[]; total: number }>;
  listFolders(workspaceId: string): Promise<WorkspaceDocumentRecord[]>;
  listFolderContents(workspaceId: string, folderId: string, params: DocumentListParams): Promise<{ items: WorkspaceDocumentRecord[]; total: number }>;
  /** URL-type documents for link re-checks (id, sourceUrl, status, indexingStatus). */
  findUrlSources(workspaceId: string): Promise<Array<Pick<WorkspaceDocumentRecord, 'id' | 'sourceUrl' | 'status' | 'indexingStatus'>>>;
  /** findByIdAndUpdate $set semantics; returns the updated record or null. */
  updateById(id: string, patch: DocumentUpdatePatch): Promise<WorkspaceDocumentRecord | null>;
  /** Dotted metadata merge ($set: { 'metadata.<key>': value }), workspace-scoped. */
  mergeMetadata(workspaceId: string, documentId: string, patch: Record<string, string>): Promise<void>;
  /** save()-path mutations preserved as semantic operations (find → set → save in Mongo). */
  markUploaded(id: string, fields: { status: string; uploadedAt: Date; url?: string; metadata?: Record<string, string> }): Promise<WorkspaceDocumentRecord | null>;
  renameOriginalName(id: string, originalName: string): Promise<WorkspaceDocumentRecord | null>;
  renameFolder(id: string, folderName: string): Promise<WorkspaceDocumentRecord | null>;
  /** null parent = move to root. */
  setParent(id: string, parentId: string | null): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteByIdAndWorkspace(id: string, workspaceId: string): Promise<void>;
  deleteManyByWorkspace(workspaceId: string): Promise<number>;
}
