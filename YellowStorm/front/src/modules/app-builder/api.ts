import { apiClient, type ApiResponse } from '@/lib/api/client';
import type {
  AppEndUserGrants,
  AppEndUserSummary,
  AppBuilderCatalog,
  ListAppBuilderAppsResponse,
} from './types';

export type { AppEndUserGrants, AppEndUserSummary };

export const appBuilderApi = {
  /** Owned deployed, shared, and draft apps for the current user. */
  async listApps(): Promise<AppBuilderCatalog> {
    const res = await apiClient.get<ApiResponse<Partial<ListAppBuilderAppsResponse> | null>>(
      '/conversation-v2/apps',
    );

    const data = res.data.data;
    return {
      deployed: data?.deployed ?? [],
      shared: data?.shared ?? [],
      drafts: data?.drafts ?? [],
    };
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
