import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { UserSearchResult } from '@/modules/workspace/types';
import type {
  Project,
  CreateProjectData,
  UpdateProjectData,
  ShareProjectData,
  ShareProjectResult,
  ProjectShareResponse,
  PaginatedProjectShares,
  SharedProjectResponse,
  PaginatedSharedProjects,
} from './types';

export async function listProjects(search?: string): Promise<Project[]> {
  const response = await apiClient.get<ApiResponse<Project[]>>(API_ENDPOINTS.projects.list, {
    params: search ? { search } : undefined,
  });
  return response.data.data;
}

export async function getProject(id: string): Promise<Project> {
  const response = await apiClient.get<ApiResponse<Project>>(API_ENDPOINTS.projects.byId(id));
  return response.data.data;
}

export async function createProject(data: CreateProjectData): Promise<Project> {
  const response = await apiClient.post<ApiResponse<Project>>(API_ENDPOINTS.projects.create, data);
  return response.data.data;
}

export async function updateProject(id: string, data: UpdateProjectData): Promise<Project> {
  const response = await apiClient.patch<ApiResponse<Project>>(API_ENDPOINTS.projects.byId(id), data);
  return response.data.data;
}

export async function deleteProject(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.projects.byId(id));
}

export async function getSharedProjects(): Promise<PaginatedSharedProjects> {
  const response = await apiClient.get<ApiResponse<PaginatedSharedProjects>>(
    API_ENDPOINTS.projects.sharedWithMe,
  );
  return response.data.data;
}

export async function setVisibility(id: string, isPublic: boolean): Promise<Project> {
  const response = await apiClient.patch<ApiResponse<Project>>(API_ENDPOINTS.projects.visibility(id), {
    isPublic,
  });
  return response.data.data;
}

export async function shareProject(projectId: string, data: ShareProjectData): Promise<ShareProjectResult> {
  const response = await apiClient.post<ApiResponse<ShareProjectResult>>(
    API_ENDPOINTS.projectShares.list(projectId),
    data,
  );
  return response.data.data;
}

export async function getProjectShares(
  projectId: string,
  params?: { page?: number; limit?: number },
): Promise<PaginatedProjectShares> {
  const response = await apiClient.get<ApiResponse<PaginatedProjectShares>>(
    API_ENDPOINTS.projectShares.list(projectId),
    { params },
  );
  return response.data.data;
}

export async function updateSharePermission(
  projectId: string,
  shareId: string,
  permission: 'read' | 'readwrite',
): Promise<ProjectShareResponse> {
  const response = await apiClient.patch<ApiResponse<ProjectShareResponse>>(
    API_ENDPOINTS.projectShares.byId(projectId, shareId),
    { permission },
  );
  return response.data.data;
}

export async function revokeShare(projectId: string, shareId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.projectShares.byId(projectId, shareId));
}

export async function searchUsers(query: string, limit: number = 10): Promise<UserSearchResult[]> {
  const response = await apiClient.get<ApiResponse<UserSearchResult[]>>(API_ENDPOINTS.users.search, {
    params: { q: query, limit },
  });
  return response.data.data;
}
