import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { appMarketplaceApi } from './api';
import type { DeployedApp } from './types';

interface AppMarketplaceState {
  apps: DeployedApp[];
  loading: boolean;
  error: boolean;
  fetchApps: () => Promise<void>;
}

export const initialState = {
  apps: [] as DeployedApp[],
  loading: false,
  error: false,
};

export const useAppMarketplaceStore = create<AppMarketplaceState>()(
  devtools(
    (set) => ({
      ...initialState,
      fetchApps: async () => {
        set({ loading: true, error: false }, false, 'fetchApps/start');
        try {
          const apps = await appMarketplaceApi.listDeployedApps();
          set({ apps, loading: false }, false, 'fetchApps/done');
        } catch {
          set({ loading: false, error: true }, false, 'fetchApps/error');
        }
      },
    }),
    { name: 'app-marketplace-store' },
  ),
);
