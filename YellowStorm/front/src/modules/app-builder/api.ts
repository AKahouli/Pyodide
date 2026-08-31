import { apiClient, type ApiResponse } from '@/lib/api/client';
import type { DeployedApp, ListDeployedAppsResponse } from './types';

export interface AppEndUserGrants {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
}

export interface AppEndUserSummary {
  id: string;
  email: string;
  displayName: string | null;
  status: 'active' | 'disabled';
  grants: AppEndUserGrants;
  createdAt: string;
}

export const appBuilderApi = {
  /** Owned + shared deployed apps of the current user, newest first. */
  async listDeployedApps(): Promise<DeployedApp[]> {
    const res = await apiClient.get<ApiResponse<ListDeployedAppsResponse>>(
      '/conversation-v2/apps',
    );
    return res.data.data.items;
  },
  /** Remove an app from App Builder without deleting its conversation. */
  async removeApp(sessionId: string): Promise<void> {
    await apiClient.delete(`/conversation-v2/apps/${sessionId}`);
  },
  async listEndUsers(sessionId: string): Promise<AppEndUserSummary[]> {
    const res = await apiClient.get<ApiResponse<{ users: AppEndUserSummary[] }>>(
      `/conversation-v2/sessions/${sessionId}/app-data/end-users`,
    );
    return res.data.data.users;
  },
  async updateEndUserGrants(
    sessionId: string,
    userId: string,
    grants: AppEndUserGrants,
  ): Promise<AppEndUserSummary> {
    const res = await apiClient.put<ApiResponse<{ user: AppEndUserSummary }>>(
      `/conversation-v2/sessions/${sessionId}/app-data/end-users/${userId}/grants`,
      grants,
    );
    return res.data.data.user;
  },
};
