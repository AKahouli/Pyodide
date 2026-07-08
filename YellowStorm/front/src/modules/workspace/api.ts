/**
 * Workspace API Functions
 */

import apiClient, { ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type {
  Workspace,
  CreateWorkspaceData,
  UpdateWorkspaceData,
  WorkspaceQueryParams,
  PaginatedWorkspaces,
  WorkspaceDocument,
  DocumentQueryParams,
  PaginatedDocuments,
  DownloadUrlResponse,
  BulkDeleteResult,
  WorkspaceSetting,
  CreateWorkspaceSettingData,
  UpdateWorkspaceSettingData,
  WorkspaceSettingQueryParams,
  PaginatedWorkspaceSettings,
  UploadUrlRequest,
  UploadUrlResponse,
  InitiateBulkUploadRequest,
  BulkUploadSession,
  CreateFolderData,
  RenameFolderData,
  ShareWorkspaceDto,
  ShareResult,
  PaginatedShares,
  PaginatedSharedWorkspaces,
  WorkspaceShareResponse,
  UserSearchResult,
  PaginatedPublicWorkspaces,
} from './types';

// ===== Workspace APIs =====

/**
 * Get workspaces for the current user
 */
export async function getWorkspaces(
  params?: WorkspaceQueryParams,
): Promise<PaginatedWorkspaces> {
  const response = await apiClient.get<ApiResponse<PaginatedWorkspaces>>(
    API_ENDPOINTS.workspaces.list,
    { params },
  );
  return response.data.data;
}

/**
 * Get or create personal workspace
 */
export async function getPersonalWorkspace(): Promise<Workspace> {
  const response = await apiClient.get<ApiResponse<Workspace>>(
    '/workspaces/personal',
  );
  return response.data.data;
}

/**
 * Get a workspace by ID
 */
export async function getWorkspace(id: string): Promise<Workspace> {
  const response = await apiClient.get<ApiResponse<Workspace>>(
    API_ENDPOINTS.workspaces.byId(id),
  );
  return response.data.data;
}

/**
 * Get a workspace by alias
 */
export async function getWorkspaceByAlias(alias: string): Promise<Workspace> {
  const response = await apiClient.get<ApiResponse<Workspace>>(
    API_ENDPOINTS.workspaces.byAlias(alias),
  );
  return response.data.data;
}

/**
 * Create a new workspace
 */
export async function createWorkspace(
  data: CreateWorkspaceData,
): Promise<Workspace> {
  const response = await apiClient.post<ApiResponse<Workspace>>(
    API_ENDPOINTS.workspaces.create,
    data,
  );
  return response.data.data;
}

/**
 * Update a workspace
 */
export async function updateWorkspace(
  id: string,
  data: UpdateWorkspaceData,
): Promise<Workspace> {
  const response = await apiClient.patch<ApiResponse<Workspace>>(
    API_ENDPOINTS.workspaces.byId(id),
    data,
  );
  return response.data.data;
}

/**
 * Delete a workspace
 */
export async function deleteWorkspace(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.workspaces.byId(id));
}

// ===== Document APIs =====

/**
 * Get documents for a workspace
 */
export async function getDocuments(
  workspaceId: string,
  params?: DocumentQueryParams,
): Promise<PaginatedDocuments> {
  const response = await apiClient.get<ApiResponse<PaginatedDocuments>>(
    API_ENDPOINTS.workspaceDocuments.list(workspaceId),
    { params },
  );
  return response.data.data;
}

/**
 * Get a document by ID
 */
export async function getDocument(
  workspaceId: string,
  docId: string,
): Promise<WorkspaceDocument> {
  const response = await apiClient.get<ApiResponse<WorkspaceDocument>>(
    API_ENDPOINTS.workspaceDocuments.byId(workspaceId, docId),
  );
  return response.data.data;
}

/**
 * Delete a document
 */
export async function deleteDocument(
  workspaceId: string,
  docId: string,
): Promise<void> {
  await apiClient.delete(
    API_ENDPOINTS.workspaceDocuments.byId(workspaceId, docId),
  );
}

/**
 * Bulk delete documents
 */
export async function bulkDeleteDocuments(
  workspaceId: string,
  documentIds: string[],
): Promise<BulkDeleteResult> {
  const response = await apiClient.delete<ApiResponse<BulkDeleteResult>>(
    API_ENDPOINTS.workspaceDocuments.bulkDelete(workspaceId),
    { data: { documentIds } },
  );
  return response.data.data;
}

/**
 * Delete all documents in a workspace
 */
export async function deleteAllDocuments(workspaceId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.workspaceDocuments.deleteAll(workspaceId));
}

/**
 * Get download URL for a document
 */
export async function getDocumentDownloadUrl(
  workspaceId: string,
  docId: string,
): Promise<DownloadUrlResponse> {
  const response = await apiClient.get<ApiResponse<DownloadUrlResponse>>(
    API_ENDPOINTS.workspaceDocuments.downloadUrl(workspaceId, docId),
  );
  return response.data.data;
}

/**
 * Trigger re-indexing of a document
 */
export async function reindexDocument(
  workspaceId: string,
  documentId: string,
  deepSearch?: boolean,
): Promise<WorkspaceDocument> {
  const params: Record<string, string> = {};
  if (deepSearch) params.deepSearch = 'true';
  const response = await apiClient.post<ApiResponse<WorkspaceDocument>>(
    API_ENDPOINTS.workspaceDocuments.reindex(workspaceId, documentId),
    undefined,
    { params: Object.keys(params).length > 0 ? params : undefined },
  );
  return response.data.data;
}

// ===== Folder APIs =====

export interface CommunityGraphData {
  documents: Array<{
    id: string;
    description: string;
    toc_text: string;
    hl_concepts: string[];
    ll_concepts: string[];
    community_id: string | null;
    file_name: string;
    metadata: Record<string, unknown>;
  }>;
  edges: Array<{
    source: string;
    target: string;
    weight: number;
    hl_jaccard: number;
    ll_jaccard: number;
    semantic_cosine: number;
    shared_hl: string[];
    shared_ll: string[];
    relationship_type: string;
    citation_raw_text?: string;
    citation_type?: string;
    citation_confidence?: number;
  }>;
  communities: Array<{
    id: string;
    level: number;
    status: string;
    member_count: number;
    dominant_hl: string[];
    dominant_ll: string[];
  }>;
  concepts: Array<{
    id: string;
    label: string;
    level: string;
    doc_freq: number;
  }>;
  concept_document_links: Array<{
    concept_id: string;
    document_id: string;
    level: string;
    weight: number;
  }>;
  shared_concept_edges: Array<{
    source: string;
    target: string;
    shared_count: number;
    shared_levels: string[];
  }>;
}

export async function fetchCommunityGraph(workspaceId: string): Promise<CommunityGraphData> {
  const response = await apiClient.get<ApiResponse<CommunityGraphData>>(
    API_ENDPOINTS.workspaceDocuments.graphData(workspaceId),
  );
  return response.data.data;
}

// ===== Folder APIs =====

/**
 * Create a folder in a workspace
 */
export async function createFolder(
  workspaceId: string,
  data: CreateFolderData,
): Promise<WorkspaceDocument> {
  const response = await apiClient.post<ApiResponse<WorkspaceDocument>>(
    `/workspaces/${workspaceId}/documents/folders`,
    data,
  );
  return response.data.data;
}

/**
 * Rename a folder
 */
export async function renameFolder(
  workspaceId: string,
  folderId: string,
  data: RenameFolderData,
): Promise<WorkspaceDocument> {
  const response = await apiClient.patch<ApiResponse<WorkspaceDocument>>(
    `/workspaces/${workspaceId}/documents/folders/${folderId}`,
    data,
  );
  return response.data.data;
}

/**
 * Delete a folder and all its contents
 */
export async function deleteFolder(
  workspaceId: string,
  folderId: string,
): Promise<{ deletedFolders: number; deletedDocuments: number }> {
  const response = await apiClient.delete<ApiResponse<{ deletedFolders: number; deletedDocuments: number }>>(
    `/workspaces/${workspaceId}/documents/folders/${folderId}`,
  );
  return response.data.data;
}

/**
 * Get contents of a specific folder
 */
export async function getFolderContents(
  workspaceId: string,
  folderId: string,
  params?: DocumentQueryParams,
): Promise<PaginatedDocuments> {
  const response = await apiClient.get<ApiResponse<PaginatedDocuments>>(
    `/workspaces/${workspaceId}/documents/folders/${folderId}`,
    { params },
  );
  return response.data.data;
}

/**
 * Move documents to a different folder
 */
export async function moveDocuments(
  workspaceId: string,
  documentIds: string[],
  targetFolderId?: string,
): Promise<{ moved: number; failed: string[] }> {
  const response = await apiClient.post<ApiResponse<{ moved: number; failed: string[] }>>(
    `/workspaces/${workspaceId}/documents/move`,
    { documentIds, targetFolderId },
  );
  return response.data.data;
}

/**
 * Get all documents and folders in hierarchical structure
 */
export async function getHierarchicalDocuments(
  workspaceId: string,
  params?: DocumentQueryParams,
): Promise<PaginatedDocuments> {
  const response = await apiClient.get<ApiResponse<PaginatedDocuments>>(
    `/workspaces/${workspaceId}/documents/hierarchical`,
    { params },
  );
  return response.data.data;
}

/**
 * Get all folders in workspace (no pagination, for sidebar)
 */
export async function getAllFolders(
  workspaceId: string,
): Promise<WorkspaceDocument[]> {
  const response = await apiClient.get<ApiResponse<WorkspaceDocument[]>>(
    `/workspaces/${workspaceId}/documents/folders/all`,
  );
  return response.data.data;
}

// ===== Workspace Settings APIs =====

/**
 * Get workspace settings for the current user
 */
export async function getWorkspaceSettings(
  params?: WorkspaceSettingQueryParams,
): Promise<PaginatedWorkspaceSettings> {
  const response = await apiClient.get<ApiResponse<PaginatedWorkspaceSettings>>(
    API_ENDPOINTS.workspaceSettings.list,
    { params },
  );
  return response.data.data;
}

/**
 * Get workspace setting templates (public templates)
 */
export async function getWorkspaceSettingTemplates(
  params?: WorkspaceSettingQueryParams,
): Promise<PaginatedWorkspaceSettings> {
  const response = await apiClient.get<ApiResponse<PaginatedWorkspaceSettings>>(
    API_ENDPOINTS.workspaceSettings.templates,
    { params },
  );
  return response.data.data;
}

/**
 * Get a workspace setting by ID
 */
export async function getWorkspaceSetting(id: string): Promise<WorkspaceSetting> {
  const response = await apiClient.get<ApiResponse<WorkspaceSetting>>(
    API_ENDPOINTS.workspaceSettings.byId(id),
  );
  return response.data.data;
}

/**
 * Create a new workspace setting
 */
export async function createWorkspaceSetting(
  data: CreateWorkspaceSettingData,
): Promise<WorkspaceSetting> {
  const response = await apiClient.post<ApiResponse<WorkspaceSetting>>(
    API_ENDPOINTS.workspaceSettings.create,
    data,
  );
  return response.data.data;
}

/**
 * Update a workspace setting
 */
export async function updateWorkspaceSetting(
  id: string,
  data: UpdateWorkspaceSettingData,
): Promise<WorkspaceSetting> {
  const response = await apiClient.patch<ApiResponse<WorkspaceSetting>>(
    API_ENDPOINTS.workspaceSettings.byId(id),
    data,
  );
  return response.data.data;
}

/**
 * Delete a workspace setting
 */
export async function deleteWorkspaceSetting(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.workspaceSettings.byId(id));
}

// ===== Document Upload APIs =====

/**
 * Upload a small file directly (< 10MB recommended)
 * Uses multipart/form-data
 */
export async function uploadSmallFile(
  workspaceId: string,
  file: File,
  onProgress?: (progress: number) => void,
  folderId?: string,
  deepSearch?: boolean,
  autoIndex?: boolean,
): Promise<WorkspaceDocument> {
  const formData = new FormData();
  formData.append('file', file);
  if (folderId) {
    formData.append('folderId', folderId);
  }
  if (deepSearch) {
    formData.append('deepSearch', 'true');
  }
  // Only send the flag when explicitly disabling — absence means "index" (back-compat).
  if (autoIndex === false) {
    formData.append('autoIndex', 'false');
  }

  const response = await apiClient.post<ApiResponse<WorkspaceDocument>>(
    API_ENDPOINTS.workspaceDocuments.upload(workspaceId),
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percent);
        }
      },
    },
  );
  return response.data.data;
}

/**
 * Request a presigned URL for large file upload
 */
export async function requestUploadUrl(
  workspaceId: string,
  request: UploadUrlRequest,
): Promise<UploadUrlResponse> {
  const response = await apiClient.post<ApiResponse<UploadUrlResponse>>(
    API_ENDPOINTS.workspaceDocuments.uploadUrl(workspaceId),
    request,
  );
  return response.data.data;
}

/**
 * Confirm that a presigned URL upload is complete
 */
export async function confirmUpload(
  workspaceId: string,
  documentId: string,
): Promise<WorkspaceDocument> {
  const response = await apiClient.post<ApiResponse<WorkspaceDocument>>(
    API_ENDPOINTS.workspaceDocuments.confirm(workspaceId),
    { documentId },
  );
  return response.data.data;
}

/**
 * Initiate a bulk upload session
 */
export async function initiateBulkUpload(
  workspaceId: string,
  request: InitiateBulkUploadRequest,
): Promise<BulkUploadSession> {
  const response = await apiClient.post<ApiResponse<BulkUploadSession>>(
    API_ENDPOINTS.workspaceDocuments.bulk(workspaceId),
    request,
  );
  return response.data.data;
}

/**
 * Complete a bulk upload session
 */
export async function completeBulkUpload(
  workspaceId: string,
  sessionId: string,
  deepSearch?: boolean,
  autoIndex?: boolean,
): Promise<BulkUploadSession> {
  const params =
    deepSearch || autoIndex === false
      ? {
          ...(deepSearch ? { deepSearch: 'true' } : {}),
          ...(autoIndex === false ? { autoIndex: 'false' } : {}),
        }
      : undefined;
  const response = await apiClient.post<ApiResponse<BulkUploadSession>>(
    API_ENDPOINTS.workspaceDocuments.bulkComplete(workspaceId, sessionId),
    undefined,
    { params },
  );
  return response.data.data;
}

/**
 * Get bulk upload session status
 */
export async function getUploadSession(
  workspaceId: string,
  sessionId: string,
): Promise<BulkUploadSession> {
  const response = await apiClient.get<ApiResponse<BulkUploadSession>>(
    API_ENDPOINTS.workspaceDocuments.bulkSession(workspaceId, sessionId),
  );
  return response.data.data;
}

/**
 * Upload a file directly to Azure using presigned URL
 * Returns progress updates via callback
 */
export function uploadToAzure(
  uploadUrl: string,
  file: File,
  onProgress?: (progress: number) => void,
  timeoutMs: number = 5 * 60 * 1000, // 5 minute timeout
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let isSettled = false;

    const settle = (error?: Error) => {
      if (isSettled) return;
      isSettled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    // Timeout handler
    const timeoutId = setTimeout(() => {
      xhr.abort();
      settle(new Error('Upload timed out'));
    }, timeoutMs);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded * 100) / event.total);
        onProgress(percent);
      }
    });

    xhr.addEventListener('load', () => {
      clearTimeout(timeoutId);
      if (xhr.status >= 200 && xhr.status < 300) {
        settle();
      } else if (xhr.status === 0) {
        // Status 0 typically indicates CORS error or network failure
        settle(new Error('Upload failed - CORS error or network failure'));
      } else {
        settle(new Error(`Upload failed with status ${xhr.status}: ${xhr.statusText}`));
      }
    });

    xhr.addEventListener('error', () => {
      clearTimeout(timeoutId);
      // For CORS errors, we often get here with no useful info
      settle(new Error('Upload failed - network error or CORS blocked'));
    });

    xhr.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      settle(new Error('Upload was aborted'));
    });

    // Handle ready state changes to catch CORS preflight failures
    xhr.addEventListener('readystatechange', () => {
      // readyState 4 = DONE, status 0 = likely CORS failure
      if (xhr.readyState === 4 && xhr.status === 0 && !isSettled) {
        clearTimeout(timeoutId);
        settle(new Error('Upload failed - CORS error or network failure'));
      }
    });

    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file);
  });
}

// ===== Workspace Share APIs =====

interface ShareQueryParams {
  page?: number;
  limit?: number;
}

interface UpdateSharePermissionDto {
  permission: 'read' | 'readwrite';
}

export async function getSharedWorkspaces(
  params?: WorkspaceQueryParams,
): Promise<PaginatedSharedWorkspaces> {
  const response = await apiClient.get<ApiResponse<PaginatedSharedWorkspaces>>(
    API_ENDPOINTS.workspaces.sharedWithMe,
    { params },
  );
  return response.data.data;
}

export async function getPublicWorkspaces(
  params?: WorkspaceQueryParams,
): Promise<PaginatedPublicWorkspaces> {
  const response = await apiClient.get<ApiResponse<PaginatedPublicWorkspaces>>(
    API_ENDPOINTS.workspaces.public,
    { params },
  );
  return response.data.data;
}

export async function setVisibility(id: string, isPublic: boolean): Promise<Workspace> {
  const response = await apiClient.patch<ApiResponse<Workspace>>(
    API_ENDPOINTS.workspaces.visibility(id),
    { isPublic },
  );
  return response.data.data;
}

export async function shareWorkspace(
  workspaceId: string,
  data: ShareWorkspaceDto,
): Promise<ShareResult> {
  const response = await apiClient.post<ApiResponse<ShareResult>>(
    API_ENDPOINTS.workspaceShares.list(workspaceId),
    data,
  );
  return response.data.data;
}

export async function getWorkspaceShares(
  workspaceId: string,
  params?: ShareQueryParams,
): Promise<PaginatedShares> {
  const response = await apiClient.get<ApiResponse<PaginatedShares>>(
    API_ENDPOINTS.workspaceShares.list(workspaceId),
    { params },
  );
  return response.data.data;
}

export async function updateSharePermission(
  workspaceId: string,
  shareId: string,
  data: UpdateSharePermissionDto,
): Promise<WorkspaceShareResponse> {
  const response = await apiClient.patch<ApiResponse<WorkspaceShareResponse>>(
    API_ENDPOINTS.workspaceShares.byId(workspaceId, shareId),
    data,
  );
  return response.data.data;
}

export async function revokeShare(workspaceId: string, shareId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.workspaceShares.byId(workspaceId, shareId));
}

export async function searchUsers(
  query: string,
  limit: number = 10,
): Promise<UserSearchResult[]> {
  const response = await apiClient.get<ApiResponse<UserSearchResult[]>>(
    API_ENDPOINTS.users.search,
    { params: { q: query, limit } },
  );
  return response.data.data;
}

// ===== Workspace Upload Settings (admin-managed) =====

export interface WorkspaceUploadSettings {
  allowedExtensions: string[];
  supportedExtensions?: string[];
  updatedAt?: string;
}

export async function getWorkspaceUploadSettings(): Promise<WorkspaceUploadSettings> {
  const response = await apiClient.get<ApiResponse<WorkspaceUploadSettings>>(
    API_ENDPOINTS.workspaceUploadSettings.current,
  );
  return response.data.data;
}

// ===== Website Link APIs =====

/**
 * Validate that a URL is reachable before adding it as a website link
 */
export async function validateUrl(
  workspaceId: string,
  url: string,
): Promise<{ reachable: boolean; status?: number; error?: string }> {
  const response = await apiClient.post<ApiResponse<{ reachable: boolean; status?: number; error?: string }>>(
    API_ENDPOINTS.workspaceDocuments.validateUrl(workspaceId),
    { url },
  );
  return response.data.data;
}

/**
 * Add a website link as a workspace document
 */
export async function addLink(
  workspaceId: string,
  url: string,
): Promise<WorkspaceDocument> {
  const response = await apiClient.post<ApiResponse<WorkspaceDocument>>(
    API_ENDPOINTS.workspaceDocuments.link(workspaceId),
    { url },
  );
  return response.data.data;
}
