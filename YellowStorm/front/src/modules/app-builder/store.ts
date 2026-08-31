import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { appBuilderApi } from './api';
import type { DeployedApp } from './types';

interface AppBuilderState {
  apps: DeployedApp[];
  loading: boolean;
  error: boolean;
  deletingSessionId: string | null;
  fetchApps: () => Promise<void>;
  removeApp: (sessionId: string) => Promise<void>;
}

export const initialState = {
  apps: [] as DeployedApp[],
  loading: false,
  error: false,
  deletingSessionId: null,
};

export const useAppBuilderStore = create<AppBuilderState>()(
  devtools(
    (set) => ({
      ...initialState,
      fetchApps: async () => {
        set({ loading: true, error: false }, false, 'fetchApps/start');
        try {
          const apps = await appBuilderApi.listDeployedApps();
          set({ apps, loading: false }, false, 'fetchApps/done');
        } catch {
          set({ loading: false, error: true }, false, 'fetchApps/error');
        }
      },
      removeApp: async (sessionId) => {
        set({ deletingSessionId: sessionId }, false, 'removeApp/start');
        try {
          await appBuilderApi.removeApp(sessionId);
          set(
            (state) => ({
              apps: state.apps.filter((app) => app.sessionId !== sessionId),
              deletingSessionId: null,
            }),
            false,
            'removeApp/done',
          );
        } catch (error) {
          set({ deletingSessionId: null }, false, 'removeApp/error');
          throw error;
        }
      },
    }),
    { name: 'app-builder-store' },
  ),
);
