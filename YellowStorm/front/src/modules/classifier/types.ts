export interface ClassifierFolder {
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

export type AssignmentSource = 'manual' | 'playbook' | null;

export interface ClassifierFile {
  id: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string | null;
  folderId: string | null;
  assignmentSource: AssignmentSource;
}

export type ClassificationRunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface ClassificationRun {
  id: string;
  workspaceId: string;
  status: ClassificationRunStatus;
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

export interface CreateFolderInput {
  name: string;
  description: string;
  parentId?: string | null;
}

export interface UpdateFolderInput {
  name?: string;
  description?: string;
}

export interface StartRunInput {
  playbookId: string;
  hint?: string;
  overwrite?: boolean;
}

export interface ListFilesQuery {
  folderId?: string;
  unclassified?: boolean;
  search?: string;
}
