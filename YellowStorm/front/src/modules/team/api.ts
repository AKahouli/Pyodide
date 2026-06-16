/**
 * Team API Functions (User-facing)
 */

import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type {
  Team,
  TeamWithAgents,
  CreateTeamData,
  UpdateTeamData,
  UpdateHierarchyData,
  GenerateTeamData,
  ShareTeamData,
  TeamShareEntry,
  TeamPermissionLevel,
  UserSearchResult,
} from './types';

export async function getAllTeams(): Promise<Team[]> {
  const response = await apiClient.get<ApiResponse<Team[]>>(API_ENDPOINTS.teams.all);
  return response.data.data;
}

export async function getTeamById(id: string): Promise<TeamWithAgents> {
  const response = await apiClient.get<ApiResponse<TeamWithAgents>>(API_ENDPOINTS.teams.byId(id));
  return response.data.data;
}

export async function createTeam(data: CreateTeamData): Promise<Team> {
  const response = await apiClient.post<ApiResponse<Team>>(API_ENDPOINTS.teams.list, data);
  return response.data.data;
}

export async function updateTeam(id: string, data: UpdateTeamData): Promise<Team> {
  const response = await apiClient.patch<ApiResponse<Team>>(API_ENDPOINTS.teams.byId(id), data);
  return response.data.data;
}

export async function updateHierarchy(id: string, data: UpdateHierarchyData): Promise<TeamWithAgents> {
  const response = await apiClient.patch<ApiResponse<TeamWithAgents>>(
    API_ENDPOINTS.teams.hierarchy(id),
    data,
  );
  return response.data.data;
}

export async function generateTeam(data: GenerateTeamData): Promise<TeamWithAgents> {
  const response = await apiClient.post<ApiResponse<TeamWithAgents>>(
    API_ENDPOINTS.teams.generate,
    data,
    { timeout: 0 }, // No timeout — AI generation can take a while
  );
  return response.data.data;
}

export async function deleteTeam(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.teams.byId(id));
}

// ===== Sharing API =====

export async function shareTeam(teamId: string, data: ShareTeamData): Promise<TeamShareEntry[]> {
  const response = await apiClient.post<ApiResponse<TeamShareEntry[]>>(
    API_ENDPOINTS.teams.shares(teamId),
    data,
  );
  return response.data.data;
}

export async function getTeamShares(teamId: string): Promise<TeamShareEntry[]> {
  const response = await apiClient.get<ApiResponse<TeamShareEntry[]>>(
    API_ENDPOINTS.teams.shares(teamId),
  );
  return response.data.data;
}

export async function updateTeamSharePermission(
  teamId: string,
  shareId: string,
  permission: TeamPermissionLevel,
): Promise<TeamShareEntry> {
  const response = await apiClient.patch<ApiResponse<TeamShareEntry>>(
    API_ENDPOINTS.teams.shareById(teamId, shareId),
    { permission },
  );
  return response.data.data;
}

export async function removeTeamShare(teamId: string, shareId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.teams.shareById(teamId, shareId));
}

export async function unshareTeam(teamId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.teams.unshare(teamId));
}

export async function searchUsers(query: string, limit = 10): Promise<UserSearchResult[]> {
  const response = await apiClient.get<ApiResponse<UserSearchResult[]>>(
    API_ENDPOINTS.users.search,
    { params: { q: query, limit } },
  );
  return response.data.data;
}
