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
