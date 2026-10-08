/** Record shapes for the workspace repository ports (Step C). Mongo-backed
 * today; the PG adapters in Step D return the same shapes. */

export interface WorkspaceRecord {
  id: string;
  name: string;
  alias: string;
  storagePrefix: string;
  description?: string;
  createdBy: string;
  /** Referenced workspace setting id, when one is attached. */
  settingsId?: string;
  documentCount: number;
  usedStorage: number;
  allocatedStorage: number;
  isSystem: boolean;
  isPersonal: boolean;
  shareCount: number;
  isPublic: boolean;
  conversationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceDocumentRecord {
  id: string;
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
  errorMessage?: string;
  metadata?: Record<string, string>;
  indexingStatus: string;
  indexingError?: string;
  indexingTaskName?: string;
  indexingTaskId?: string;
  indexingAttemptId?: string;
  indexingAttemptStartedAt?: Date;
  indexingAttemptCompletedAt?: Date;
  lastIndexedAt?: Date;
  indexingStartedAt?: Date;
  detected_language?: string;
  chunk_size?: number;
  parentId?: string;
  isFolder: boolean;
  folderName?: string;
  type: string;
  sourceUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceSettingRecord {
  id: string;
  name: string;
  description?: string;
  tag?: string;
  llmModel?: string;
  isTemplate: boolean;
  isPredefined: boolean;
  createdBy: string;
  instruction?: string;
  chunks: number;
  hybridSearch: boolean;
  ragType: string;
  maxToken: number;
  topK: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceShareRecord {
  id: string;
  workspaceId: string;
  ownerId: string;
  sharedWithUserId: string;
  permission: 'read' | 'readwrite';
  sharedBy: string;
  createdAt: Date;
  updatedAt: Date;
}
/**
 * Field patch for the indexing pipeline's document mutations. NOTE: never pass
 * undefined for `status` or `indexingStatus` — both columns are NOT NULL in PG
 * (present-undefined would violate the constraint rather than reset to default).
 * Semantics match
 * Mongoose instance assignment: keys PRESENT with an undefined value clear the
 * field; keys ABSENT are left untouched; `metadata` (when present) replaces
 * the whole object. The store persists via save() (Mongo adapter) so validators
 * and timestamps keep their old behavior.
 */
export interface IndexingStatePatch {
  status?: string | undefined;
  indexingStatus?: string | undefined;
  indexingError?: string | undefined;
  indexingTaskName?: string | undefined;
  indexingTaskId?: string | undefined;
  indexingAttemptId?: string | undefined;
  indexingAttemptStartedAt?: Date | undefined;
  indexingAttemptCompletedAt?: Date | undefined;
  indexingStartedAt?: Date | undefined;
  lastIndexedAt?: Date | undefined;
  detected_language?: string | undefined;
  chunk_size?: number | undefined;
  metadata?: Record<string, string>;
  filename?: string | undefined;
}

