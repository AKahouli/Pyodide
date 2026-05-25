/**
 * Workspace Module Types
 * Mirrors backend interfaces for type safety
 */

// ===== Enums =====

export type RagType = 'standard' | 'advancedRag' | 'smartRag';

export type DocumentStatus = 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';

export type IndexingStatus = 'none' | 'pending' | 'processing' | 'ready' | 'failed';

// ===== Pagination =====

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ===== Workspace Types =====

export interface Workspace {
  id: string;
  name: string;
  alias: string;
  description?: string;
  createdBy: string;
  settings?: string;
  documentCount: number;
  usedStorage: number;
  allocatedStorage: number;
  isSystem: boolean;
  isPersonal: boolean;
  shareCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceData {
  name: string;
  description?: string;
  settings?: string;
}

export interface UpdateWorkspaceData {
  name?: string;
  description?: string;
  settings?: string | null; // null to clear settings
}

export interface WorkspaceQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedWorkspaces {
  workspaces: Workspace[];
  pagination: PaginationInfo;
}

// ===== Document Types =====

export interface WorkspaceDocument {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  url?: string; // Optional for pending documents
  contentHash?: string;
  workspaceId: string;
  createdBy: string;
  status: DocumentStatus;
  uploadedAt?: string;
  errorMessage?: string;
  metadata?: Record<string, string>;
  indexingStatus: IndexingStatus;
  indexingError?: string;
  indexingTaskName?: string;
  indexingTaskId?: string;
  lastIndexedAt?: string;
  parentId?: string;
  isFolder: boolean;
  folderName?: string;
  detected_language?: string;
  chunk_size?: number;
  createdAt: string;
  updatedAt: string;
}

// ===== Folder Types =====

export interface CreateFolderData {
  name: string;
  parentId?: string;
}

export interface RenameFolderData {
  name: string;
}

// ===== Workspace Page (folders/files/classification) =====

export interface WorkspaceFolder {
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

export interface WorkspaceFile {
  id: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string | null;
  folderId: string | null;
  assignmentSource: AssignmentSource;
}

export type ClassifierRuleScope = 'global' | 'local';

export interface ClassifierRule {
  id: string;
  userId: string;
  scope: ClassifierRuleScope;
  workspaceId: string | null;
  text: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClassifierRuleInput {
  scope: ClassifierRuleScope;
  workspaceId?: string;
  text: string;
  enabled?: boolean;
}

export interface UpdateClassifierRuleInput {
  text?: string;
  enabled?: boolean;
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

export interface CreateWorkspaceFolderInput {
  name: string;
  description: string;
  parentId?: string | null;
}

export interface UpdateWorkspaceFolderInput {
  name?: string;
  description?: string;
}

export interface StartClassificationRunInput {
  playbookId: string;
  hint?: string;
  overwrite?: boolean;
}

export interface ListWorkspaceFilesQuery {
  folderId?: string;
  unclassified?: boolean;
  search?: string;
}

export interface DocumentQueryParams {
  page?: number;
  limit?: number;
  status?: DocumentStatus;
  search?: string;
  sortBy?: 'originalName' | 'createdAt' | 'size';
  sortOrder?: 'asc' | 'desc';
  parentId?: string | null;
}

export interface PaginatedDocuments {
  documents: WorkspaceDocument[];
  pagination: PaginationInfo;
}

export interface DownloadUrlResponse {
  url: string;
  expiresAt: string;
}

export interface BulkDeleteResult {
  deleted: number;
  failed: string[];
}

// ===== Workspace Setting Types =====

export interface WorkspaceSetting {
  id: string;
  name: string;
  description?: string;
  tag?: string;
  model?: string;
  isTemplate: boolean;
  isPredefined: boolean;
  createdBy: string;
  instruction?: string;
  chunks: number;
  hybridSearch: boolean;
  ragType: RagType;
  maxToken: number;
  topK: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceSettingData {
  name: string;
  description?: string;
  tag?: string;
  model?: string;
  isTemplate?: boolean;
  instruction?: string;
  chunks?: number;
  hybridSearch?: boolean;
  ragType?: RagType;
  maxToken?: number;
  topK?: number;
}

export interface UpdateWorkspaceSettingData {
  name?: string;
  description?: string;
  tag?: string;
  model?: string;
  isTemplate?: boolean;
  instruction?: string;
  chunks?: number;
  hybridSearch?: boolean;
  ragType?: RagType;
  maxToken?: number;
  topK?: number;
}

export interface WorkspaceSettingQueryParams {
  page?: number;
  limit?: number;
  tag?: string;
  search?: string;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedWorkspaceSettings {
  settings: WorkspaceSetting[];
  pagination: PaginationInfo;
}

// ===== Upload Types =====

export type UploadFileStatus = 'pending' | 'uploading' | 'completed' | 'failed';

export type UploadSessionStatus = 'pending' | 'uploading' | 'completing' | 'completed' | 'failed';

export interface UploadUrlRequest {
  filename: string;
  mimeType: string;
  size: number;
}

export interface UploadUrlResponse {
  documentId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface BulkUploadFileInfo {
  index: number;
  filename: string;
  mimeType: string;
  size: number;
  documentId: string;
  uploadUrl: string;
  status: UploadFileStatus;
  progress: number;
  error?: string;
}

export interface BulkUploadSession {
  sessionId: string;
  workspaceId: string;
  status: UploadSessionStatus;
  files: BulkUploadFileInfo[];
  totalFiles: number;
  totalSize: number;
  completedFiles: number;
  failedFiles: number;
  expiresAt: string;
  createdAt: string;
}

export interface InitiateBulkUploadRequest {
  files: UploadUrlRequest[];
}

export interface ReportProgressRequest {
  fileIndex: number;
  progress: number;
  status: UploadFileStatus;
  error?: string;
}

// ===== Workspace Share Types =====

export type WorkspacePermission = 'read' | 'readwrite';

export type WorkspaceRole = 'owner' | WorkspacePermission;

export type WorkspaceTab = 'personal' | 'shared';

export interface SharedUserInfo {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface WorkspaceShareResponse {
  id: string;
  workspaceId: string;
  user: SharedUserInfo;
  permission: WorkspacePermission;
  sharedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShareWorkspaceEntry {
  email: string;
  permission: WorkspacePermission;
}

export interface ShareWorkspaceDto {
  shares: ShareWorkspaceEntry[];
}

export interface ShareResult {
  shared: WorkspaceShareResponse[];
  notFound: string[];
  invalid: string[];
}

export interface PaginatedShares {
  shares: WorkspaceShareResponse[];
  pagination: PaginationInfo;
}

export interface SharedWorkspaceResponse {
  id: string;
  name: string;
  alias: string;
  description?: string;
  owner: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  permission: WorkspacePermission;
  shareId: string;
  documentCount: number;
  usedStorage: number;
  allocatedStorage: number;
  sharedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedSharedWorkspaces {
  workspaces: SharedWorkspaceResponse[];
  pagination: PaginationInfo;
}

export interface UserSearchResult {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export type WorkspaceListItem = Workspace | SharedWorkspaceResponse;

export function isWorkspace(item: WorkspaceListItem): item is Workspace {
  return 'createdBy' in item;
}

export function isSharedWorkspace(item: WorkspaceListItem): item is SharedWorkspaceResponse {
  return 'shareId' in item;
}

// Local upload tracking (for UI state)
export interface UploadQueueItem {
  id: string; // Local unique ID
  file: File;
  workspaceId: string;
  folderId?: string;
  status: UploadFileStatus;
  progress: number;
  error?: string;
  documentId?: string; // Set after backend creates document record
  uploadUrl?: string; // For presigned URL uploads
}
