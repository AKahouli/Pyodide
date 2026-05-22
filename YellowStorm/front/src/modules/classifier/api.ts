import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type {
  ClassificationRun,
  ClassifierFile,
  ClassifierFolder,
  CreateFolderInput,
  ListFilesQuery,
  StartRunInput,
  UpdateFolderInput,
} from './types';

interface PaginatedRuns {
  items: ClassificationRun[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ───────── Folders ─────────

export async function listFolders(workspaceId: string): Promise<ClassifierFolder[]> {
  const response = await apiClient.get<ApiResponse<ClassifierFolder[]>>(
    API_ENDPOINTS.classifier.folders(workspaceId),
  );
  return response.data.data;
}

export async function createFolder(
  workspaceId: string,
  input: CreateFolderInput,
): Promise<ClassifierFolder> {
  const response = await apiClient.post<ApiResponse<ClassifierFolder>>(
    API_ENDPOINTS.classifier.folders(workspaceId),
    {
      name: input.name,
      description: input.description,
      parentId: input.parentId ?? null,
    },
  );
  return response.data.data;
}

export async function getFolder(folderId: string): Promise<ClassifierFolder> {
  const response = await apiClient.get<ApiResponse<ClassifierFolder>>(
    API_ENDPOINTS.classifier.folderById(folderId),
  );
  return response.data.data;
}

export async function updateFolder(
  folderId: string,
  input: UpdateFolderInput,
): Promise<ClassifierFolder> {
  const response = await apiClient.patch<ApiResponse<ClassifierFolder>>(
    API_ENDPOINTS.classifier.folderById(folderId),
    input,
  );
  return response.data.data;
}

export async function moveFolder(
  folderId: string,
  parentId: string | null,
): Promise<ClassifierFolder> {
  const response = await apiClient.post<ApiResponse<ClassifierFolder>>(
    API_ENDPOINTS.classifier.folderMove(folderId),
    { parentId },
  );
  return response.data.data;
}

export async function deleteFolder(folderId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.classifier.folderById(folderId));
}

// ───────── Files ─────────

export async function listFiles(
  workspaceId: string,
  query: ListFilesQuery = {},
): Promise<ClassifierFile[]> {
  const params: Record<string, string> = {};
  if (query.folderId) params.folderId = query.folderId;
  if (query.unclassified) params.unclassified = 'true';
  if (query.search) params.search = query.search;
  const response = await apiClient.get<ApiResponse<ClassifierFile[]>>(
    API_ENDPOINTS.classifier.files(workspaceId),
    { params: Object.keys(params).length ? params : undefined },
  );
  return response.data.data;
}

export async function assignFileToFolder(
  workspaceId: string,
  documentId: string,
  folderId: string | null,
): Promise<ClassifierFile> {
  const response = await apiClient.put<ApiResponse<ClassifierFile>>(
    API_ENDPOINTS.classifier.fileFolder(workspaceId, documentId),
    { folderId },
  );
  return response.data.data;
}

// ───────── Runs ─────────

export async function startRun(
  workspaceId: string,
  input: StartRunInput,
): Promise<ClassificationRun> {
  const response = await apiClient.post<ApiResponse<ClassificationRun>>(
    API_ENDPOINTS.classifier.runs(workspaceId),
    input,
  );
  return response.data.data;
}

export async function listRuns(
  workspaceId: string,
  page = 1,
  limit = 10,
): Promise<PaginatedRuns> {
  const response = await apiClient.get<ApiResponse<PaginatedRuns>>(
    API_ENDPOINTS.classifier.runs(workspaceId),
    { params: { page, limit } },
  );
  return response.data.data;
}

export async function getRun(runId: string): Promise<ClassificationRun> {
  const response = await apiClient.get<ApiResponse<ClassificationRun>>(
    API_ENDPOINTS.classifier.runById(runId),
  );
  return response.data.data;
}
