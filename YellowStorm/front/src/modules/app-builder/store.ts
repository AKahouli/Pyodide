import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useConversationV2PointersStore } from '@/modules/conversation-v2/store';
import { appBuilderApi } from './api';
import type { AppBuilderCatalog } from './types';

interface AppBuilderState extends AppBuilderCatalog {
  loading: boolean;
  error: boolean;
  deletingSessionId: string | null;
  fetchApps: () => Promise<void>;
  removeApp: (sessionId: string) => Promise<void>;
  removeDraft: (sessionId: string) => Promise<void>;
}

export const emptyCatalog = (): AppBuilderCatalog => ({
  deployed: [],
  shared: [],
  drafts: [],
});

export const initialState = {
  ...emptyCatalog(),
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
          const catalog = await appBuilderApi.listApps();
          set({ ...catalog, loading: false }, false, 'fetchApps/done');
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
              deployed: state.deployed.filter((app) => app.sessionId !== sessionId),
              shared: state.shared.filter((app) => app.sessionId !== sessionId),
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
      removeDraft: async (sessionId) => {
        set({ deletingSessionId: sessionId }, false, 'removeDraft/start');
        try {
          // Soft-delete the conversation (same path as conversation-v2 sidebar).
          await useConversationV2PointersStore.getState().remove(sessionId);
          set(
            (state) => ({
              drafts: state.drafts.filter((app) => app.sessionId !== sessionId),
              deletingSessionId: null,
            }),
            false,
            'removeDraft/done',
          );
        } catch (error) {
          set({ deletingSessionId: null }, false, 'removeDraft/error');
          throw error;
        }
      },
    }),
    { name: 'app-builder-store' },
  ),
);
