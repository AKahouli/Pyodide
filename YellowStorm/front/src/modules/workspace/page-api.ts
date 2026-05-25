import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type {
  ClassificationRun,
  ClassifierRule,
  ClassifierRuleScope,
  CreateClassifierRuleInput,
  CreateWorkspaceFolderInput,
  ListWorkspaceFilesQuery,
  StartClassificationRunInput,
  UpdateClassifierRuleInput,
  UpdateWorkspaceFolderInput,
  WorkspaceFile,
  WorkspaceFolder,
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

export async function listFolders(workspaceId: string): Promise<WorkspaceFolder[]> {
  const response = await apiClient.get<ApiResponse<WorkspaceFolder[]>>(
    API_ENDPOINTS.classifier.folders(workspaceId),
  );
  return response.data.data;
}

export async function createFolder(
  workspaceId: string,
  input: CreateWorkspaceFolderInput,
): Promise<WorkspaceFolder> {
  const response = await apiClient.post<ApiResponse<WorkspaceFolder>>(
    API_ENDPOINTS.classifier.folders(workspaceId),
    {
      name: input.name,
      description: input.description,
      parentId: input.parentId ?? null,
    },
  );
  return response.data.data;
}

export async function getFolder(folderId: string): Promise<WorkspaceFolder> {
  const response = await apiClient.get<ApiResponse<WorkspaceFolder>>(
    API_ENDPOINTS.classifier.folderById(folderId),
  );
  return response.data.data;
}

export async function updateFolder(
  folderId: string,
  input: UpdateWorkspaceFolderInput,
): Promise<WorkspaceFolder> {
  const response = await apiClient.patch<ApiResponse<WorkspaceFolder>>(
    API_ENDPOINTS.classifier.folderById(folderId),
    input,
  );
  return response.data.data;
}

export async function moveFolder(
  folderId: string,
  parentId: string | null,
): Promise<WorkspaceFolder> {
  const response = await apiClient.post<ApiResponse<WorkspaceFolder>>(
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
  query: ListWorkspaceFilesQuery = {},
): Promise<WorkspaceFile[]> {
  const params: Record<string, string> = {};
  if (query.folderId) params.folderId = query.folderId;
  if (query.unclassified) params.unclassified = 'true';
  if (query.search) params.search = query.search;
  const response = await apiClient.get<ApiResponse<WorkspaceFile[]>>(
    API_ENDPOINTS.classifier.files(workspaceId),
    { params: Object.keys(params).length ? params : undefined },
  );
  return response.data.data;
}

export async function assignFileToFolder(
  workspaceId: string,
  documentId: string,
  folderId: string | null,
): Promise<WorkspaceFile> {
  const response = await apiClient.put<ApiResponse<WorkspaceFile>>(
    API_ENDPOINTS.classifier.fileFolder(workspaceId, documentId),
    { folderId },
  );
  return response.data.data;
}

// ───────── Runs ─────────

export async function startRun(
  workspaceId: string,
  input: StartClassificationRunInput,
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

// ───────── Rules ─────────

export async function listRules(query: {
  scope: ClassifierRuleScope;
  workspaceId?: string;
}): Promise<ClassifierRule[]> {
  const params: Record<string, string> = { scope: query.scope };
  if (query.workspaceId) params.workspaceId = query.workspaceId;
  const response = await apiClient.get<ApiResponse<ClassifierRule[]>>(
    API_ENDPOINTS.classifier.rules,
    { params },
  );
  return response.data.data;
}

export async function createRule(
  input: CreateClassifierRuleInput,
): Promise<ClassifierRule> {
  const response = await apiClient.post<ApiResponse<ClassifierRule>>(
    API_ENDPOINTS.classifier.rules,
    input,
  );
  return response.data.data;
}

export async function updateRule(
  ruleId: string,
  input: UpdateClassifierRuleInput,
): Promise<ClassifierRule> {
  const response = await apiClient.patch<ApiResponse<ClassifierRule>>(
    API_ENDPOINTS.classifier.ruleById(ruleId),
    input,
  );
  return response.data.data;
}

export async function deleteRule(ruleId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.classifier.ruleById(ruleId));
}
