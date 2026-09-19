import type { WorkspaceRecord } from '../ports/workspace-records';

export const WORKSPACE_STORE = Symbol('WORKSPACE_STORE');

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

/** Internal write/read store for the workspace aggregate (plan D.5). */
export interface WorkspaceStore {
  /** Mongo-only legacy backfill (alias → storagePrefix); PG is a no-op. */
  backfillStoragePrefixFromAlias(): Promise<number>;
  countNonSystemByOwner(userId: string): Promise<number>;
  findByName(ownerId: string, name: string, excludeWorkspaceId?: string): Promise<WorkspaceRecord | null>;
  findByOwnerAndAlias(userId: string, alias: string, excludeWorkspaceId?: string): Promise<WorkspaceRecord | null>;
  findByOwnerPersonal(userId: string): Promise<WorkspaceRecord | null>;
  findById(id: string): Promise<WorkspaceRecord | null>;
  findByIds(ids: string[]): Promise<Map<string, WorkspaceRecord>>;
  /** IDs from `ids` that are owned by `userId` (access checks). */
  filterOwned(ids: string[], userId: string): Promise<string[]>;
  /** IDs from `ids` that are public (access checks). */
  filterPublic(ids: string[]): Promise<string[]>;
  /** Non-system workspaces owned by `userId`, id-only, no pagination. */
  findIdsByOwner(userId: string): Promise<string[]>;
  listByUser(userId: string, params: WorkspaceListParams): Promise<{ items: WorkspaceRecord[]; total: number }>;
  listPublic(userId: string, params: WorkspaceListPublicParams): Promise<{ items: WorkspaceRecord[]; total: number }>;
  create(input: WorkspaceCreateInput): Promise<WorkspaceRecord>;
  updateFields(id: string, patch: WorkspaceUpdatePatch): Promise<void>;
  /** Stored counters are copied from Mongo and incremented, never recomputed. */
  incrementCounters(id: string, delta: WorkspaceCounterDelta): Promise<void>;
  deleteById(id: string): Promise<void>;
  findSystemWorkspace(userId: string, conversationId: string): Promise<WorkspaceRecord | null>;
  /** Deletes a workspace only when it is a system workspace. */
  deleteSystemWorkspace(id: string): Promise<void>;
}
