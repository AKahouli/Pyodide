import type { WorkspaceRecord } from '../ports/workspace-records';

/** Pagination/sort parameters for the user workspace listing. */
export interface WorkspaceListParams {
  search?: string;
  skip: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export interface WorkspaceListPublicParams {
  search?: string;
  skip: number;
  limit: number;
}

export interface WorkspaceCreateInput {
  name: string;
  alias: string;
  storagePrefix: string;
  description?: string;
  createdBy: string;
  settingsId?: string;
  documentCount?: number;
  usedStorage?: number;
  allocatedStorage: number;
  isSystem?: boolean;
  isPersonal?: boolean;
  conversationId?: string | null;
}

/** Patch for updateFields: only keys explicitly present are written. */
export interface WorkspaceUpdatePatch {
  name?: string;
  alias?: string;
  description?: string;
  /** string = attach, null = detach. */
  settingsId?: string | null;
  isPublic?: boolean;
}

export interface WorkspaceCounterDelta {
  usedStorage?: number;
  documentCount?: number;
  shareCount?: number;
}

