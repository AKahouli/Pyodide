import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useConversationV2PointersStore } from '@/modules/conversation-v2/store';
import { appBuilderApi, templateCatalogApi } from './api';
import type { AppBuilderCatalog, AppTemplate, TemplateCategory } from './types';

interface AppBuilderState extends AppBuilderCatalog {
  loading: boolean;
  error: boolean;
  deletingSessionId: string | null;
  fetchApps: () => Promise<void>;
  removeApp: (sessionId: string) => Promise<void>;
  removeDraft: (sessionId: string) => Promise<void>;

  categories: TemplateCategory[];
  categoriesLoading: boolean;
  categoriesError: boolean;
  templates: AppTemplate[];
  templatesLoading: boolean;
  templatesError: boolean;
  /** null = "All applications" (existing catalog view). */
  selectedCategoryId: string | null;
  fetchCategories: () => Promise<void>;
  selectCategory: (categoryId: string | null) => void;
  fetchTemplates: (categoryId: string) => Promise<void>;
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
  categories: [] as TemplateCategory[],
  categoriesLoading: false,
  categoriesError: false,
  templates: [] as AppTemplate[],
  templatesLoading: false,
  templatesError: false,
  selectedCategoryId: null as string | null,
};

export const useAppBuilderStore = create<AppBuilderState>()(
  devtools(
    (set, get) => ({
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
      fetchCategories: async () => {
        set({ categoriesLoading: true, categoriesError: false }, false, 'fetchCategories/start');
        try {
          const categories = await templateCatalogApi.listCategories();
          set({ categories, categoriesLoading: false }, false, 'fetchCategories/done');
        } catch {
          set({ categoriesLoading: false, categoriesError: true }, false, 'fetchCategories/error');
        }
      },
      selectCategory: (categoryId) => {
        set({ selectedCategoryId: categoryId }, false, 'selectCategory');
        if (categoryId) {
          void get().fetchTemplates(categoryId);
        } else {
          set({ templates: [] }, false, 'selectCategory/clear');
        }
      },
      fetchTemplates: async (categoryId) => {
        set({ templatesLoading: true, templatesError: false }, false, 'fetchTemplates/start');
        try {
          const templates = await templateCatalogApi.listTemplates(categoryId);
          // Ignore a stale response if the selection changed mid-flight.
          if (get().selectedCategoryId !== categoryId) return;
          set({ templates, templatesLoading: false }, false, 'fetchTemplates/done');
        } catch {
          set({ templatesLoading: false, templatesError: true }, false, 'fetchTemplates/error');
        }
      },
    }),
    { name: 'app-builder-store' },
  ),
);
