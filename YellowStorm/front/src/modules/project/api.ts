import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { Project, CreateProjectData, UpdateProjectData } from './types';

export async function listProjects(search?: string): Promise<Project[]> {
  const response = await apiClient.get<ApiResponse<Project[]>>(API_ENDPOINTS.projects.list, {
    params: search ? { search } : undefined,
  });
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
