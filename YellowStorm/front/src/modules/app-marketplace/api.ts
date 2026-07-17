import { apiClient, type ApiResponse } from '@/lib/api/client';
import type { DeployedApp, ListDeployedAppsResponse } from './types';

export const appMarketplaceApi = {
  /** Deployed conversation-v2 apps of the current user, newest first. */
  async listDeployedApps(): Promise<DeployedApp[]> {
    const res = await apiClient.get<ApiResponse<ListDeployedAppsResponse>>(
      '/conversation-v2/apps',
    );
    return res.data.data.items;
  },
};
