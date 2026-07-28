export interface IClassifierFolderResponse {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  description: string;
  createdBy: string;
  childCount: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface IClassifierFileResponse {
  id: string; // documentId
  workspaceId: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string | null;
  folderId: string | null;
  assignmentSource: 'manual' | 'playbook' | null;
  /** Ceph object key — surfaced so the file viewer can sign it directly. */
  path?: string;
  /** Vectorstore indexing status, surfaced for the per-file status indicator. */
  indexingStatus: 'none' | 'pending' | 'processing' | 'ready' | 'failed';
  indexingError?: string;
  lastIndexedAt?: string;
  type: 'doc' | 'url';
  sourceUrl?: string;
  /** Browse-session start URL this url-doc was indexed from (workspace grouping). */
  sourceRootUrl?: string;
  /** Normalized form of sourceRootUrl (legacy grouping key / fallback). */
  normalizedSourceRootUrl?: string;
  /** Per-index-batch group id — the workspace grouping key. */
  sourceGroupId?: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';
}

export type ClassificationRunStatusValue =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface IClassifierRuleResponse {
  id: string;
  userId: string;
  scope: 'global' | 'local';
  workspaceId: string | null;
  text: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IClassificationRunResponse {
  id: string;
  workspaceId: string;
  status: ClassificationRunStatusValue;
  playbookId: string;
  playbookExecutionId: string | null;
  hint: string | null;
  overwrite: boolean;
  totalFiles: number;
  classifiedFiles: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  triggeredBy: string;
  createdAt: string;
  updatedAt: string;
}
