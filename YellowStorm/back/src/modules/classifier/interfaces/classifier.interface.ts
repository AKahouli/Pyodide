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
