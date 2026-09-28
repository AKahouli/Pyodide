export enum AssignmentSource {
  MANUAL = 'manual',
  PLAYBOOK = 'playbook',
}

export enum ClassificationRunStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum ClassifierRuleScope {
  GLOBAL = 'global',
  LOCAL = 'local',
}

/** Plain records the repositories hand to the services (ids are 24-char hex strings). */
export interface ClassifierFolderRecord {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  description: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClassifierAssignmentRecord {
  id: string;
  workspaceId: string;
  documentId: string;
  folderId: string | null;
  assignmentSource: AssignmentSource;
  classificationRunId: string | null;
  assignedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClassifierRuleRecord {
  id: string;
  userId: string;
  scope: ClassifierRuleScope;
  workspaceId: string | null;
  text: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClassificationRunRecord {
  id: string;
  workspaceId: string;
  status: ClassificationRunStatus;
  playbookId: string;
  playbookExecutionId: string | null;
  hint: string | null;
  overwriteExisting: boolean;
  totalFiles: number;
  classifiedFiles: number;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  triggeredBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FolderCounts {
  childCount: number;
  fileCount: number;
}
