/**
 * Groups API Functions
 */

import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { UserGroup, CreateGroupData, UpdateGroupData, UserSearchResult } from './types';

export async function getGroups(): Promise<UserGroup[]> {
  const response = await apiClient.get<ApiResponse<UserGroup[]>>(API_ENDPOINTS.userGroups.list);
  return response.data.data;
}

export async function createGroup(data: CreateGroupData): Promise<UserGroup> {
  const response = await apiClient.post<ApiResponse<UserGroup>>(API_ENDPOINTS.userGroups.list, data);
  return response.data.data;
}

export async function updateGroup(id: string, data: UpdateGroupData): Promise<UserGroup> {
  const response = await apiClient.patch<ApiResponse<UserGroup>>(API_ENDPOINTS.userGroups.byId(id), data);
  return response.data.data;
}

export async function deleteGroup(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.userGroups.byId(id));
}

export async function addMembers(id: string, userIds: string[]): Promise<UserGroup> {
  const response = await apiClient.post<ApiResponse<UserGroup>>(
    API_ENDPOINTS.userGroups.members(id),
    { userIds },
  );
  return response.data.data;
}

export async function removeMember(id: string, userId: string): Promise<UserGroup> {
  const response = await apiClient.delete<ApiResponse<UserGroup>>(
    API_ENDPOINTS.userGroups.memberById(id, userId),
  );
  return response.data.data;
}

export async function searchUsers(query: string, limit = 10): Promise<UserSearchResult[]> {
  const response = await apiClient.get<ApiResponse<UserSearchResult[]>>(
    API_ENDPOINTS.users.search,
    { params: { q: query, limit } },
  );
  return response.data.data;
}
