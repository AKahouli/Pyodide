import { apiClient, type ApiResponse } from '@/lib/api/client';
import type { DeployedApp, ListDeployedAppsResponse } from './types';

export const appMarketplaceApi = {
  /** Owned + shared deployed apps of the current user, newest first. */
  async listDeployedApps(): Promise<DeployedApp[]> {
    const res = await apiClient.get<ApiResponse<ListDeployedAppsResponse>>(
      '/conversation-v2/apps',
    );
    return res.data.data.items;
  },
  /** Remove an app from Marketplace without deleting its conversation. */
  async removeApp(sessionId: string): Promise<void> {
    await apiClient.delete(`/conversation-v2/apps/${sessionId}`);
  },
};
