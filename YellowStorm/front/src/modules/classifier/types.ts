export interface ClassifierWorkspace {
  id: string;
  name: string;
}

export interface ClassifierFolder {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassifierFile {
  id: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  folderId: string | null;
}

export type ClassifierItem =
  | ({ kind: 'folder' } & ClassifierFolder)
  | ({ kind: 'file' } & ClassifierFile);

export type ClassificationStatus = 'idle' | 'running' | 'success' | 'error';

export interface ClassificationRun {
  id: string;
  workspaceId: string;
  status: ClassificationStatus;
  startedAt: string;
  finishedAt?: string;
  playbook: string;
  totalFiles: number;
  classifiedFiles: number;
}
