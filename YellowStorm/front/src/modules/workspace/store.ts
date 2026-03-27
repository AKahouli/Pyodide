/**
 * Workspace Zustand Store
 * Global state management with pagination caching
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import * as workspaceApi from './api';
import { DEFAULT_PAGE_LIMIT } from './utils';
import { getErrorMessage } from '@/lib/error-codes';
import type { ApiError } from '@/lib/api/client';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

/**
 * Extract user-friendly error message from API error
 * Uses error code mapping when available, falls back to error message
 */
function getApiErrorMessage(err: unknown, fallback: string): string {
  // Check if it's an API error with a code
  if (err && typeof err === 'object' && 'code' in err) {
    const apiError = err as ApiError;
    return getErrorMessage(apiError.code);
  }
  // Fall back to error message or default
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}
type WorkspaceTranslator = (key: ModuleTranslationKey<'workspace'>, params?: TranslationParams) => string;

let workspaceTranslator: WorkspaceTranslator | null = null;

export function setWorkspaceTranslator(translator?: WorkspaceTranslator) {
  workspaceTranslator = translator ?? null;
}

const getWorkspaceTranslationKey = (segment: string) => `store.${segment}` as ModuleTranslationKey<'workspace'>;

const translateWorkspaceString = (segment: string, fallback: string, params?: TranslationParams) => {
  if (workspaceTranslator) {
    return workspaceTranslator(getWorkspaceTranslationKey(segment), params);
  }
  return fallback;
};

const tError = (key: string, fallback: string) => translateWorkspaceString(`errors.${key}`, fallback);
const tToast = (key: string, fallback: string, params?: TranslationParams) => translateWorkspaceString(`toast.${key}`, fallback, params);
import type { Workspace, WorkspaceDocument, WorkspaceSetting, CreateWorkspaceData, UpdateWorkspaceData, CreateWorkspaceSettingData, UpdateWorkspaceSettingData, BulkDeleteResult, UploadQueueItem, UploadFileStatus } from './types';

// ===== State Types =====

interface WorkspaceState {
  // Workspace data with page caching
  workspaces: Map<number, Workspace[]>;
  currentPage: number;
  totalPages: number;
  totalWorkspaces: number;
  searchQuery: string;

  // Selected workspace
  selectedWorkspaceId: string | null;
  selectedWorkspace: Workspace | null;

  // Documents with page caching
  documents: Map<number, WorkspaceDocument[]>;
  documentsCurrentPage: number;
  documentsTotalPages: number;
  totalDocuments: number;
  documentSearchQuery: string;

  // Templates
  templates: WorkspaceSetting[];

  // Settings modal state (independent from selected workspace)
  settingsTargetWorkspace: Workspace | null;
  currentWorkspaceSettings: WorkspaceSetting | null;
  isLoadingSettings: boolean;
  isSavingSettings: boolean;

  // UI State
  isModalOpen: boolean;
  isCreateModalOpen: boolean;
  isCreateTemplateModalOpen: boolean;
  isSettingsModalOpen: boolean;
  createModalStep: 1 | 2;
  createTemplateModalStep: 1 | 2;
  isMobileSidebarOpen: boolean;

  // Loading states
  isLoadingWorkspaces: boolean;
  isLoadingDocuments: boolean;
  isLoadingTemplates: boolean;
  isCreating: boolean;
  isDeleting: boolean;

  // Error state
  error: string | null;

  // Upload state
  uploadQueue: UploadQueueItem[];
  isUploading: boolean;
  uploadSessionId: string | null;
}

interface WorkspaceActions {
  // Modal controls
  openModal: () => void;
  closeModal: () => void;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  openCreateTemplateModal: () => void;
  closeCreateTemplateModal: () => void;
  openSettingsModal: (workspace?: Workspace) => void;
  closeSettingsModal: () => void;
  setCreateModalStep: (step: 1 | 2) => void;
  setCreateTemplateModalStep: (step: 1 | 2) => void;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;

  // Workspace operations
  fetchWorkspaces: (page?: number) => Promise<void>;
  searchWorkspaces: (query: string) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (data: CreateWorkspaceData) => Promise<Workspace>;
  updateWorkspace: (id: string, data: UpdateWorkspaceData) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  renameWorkspace: (id: string, name: string) => Promise<void>;

  // Document operations
  fetchDocuments: (workspaceId: string, page?: number) => Promise<void>;
  searchDocuments: (query: string) => Promise<void>;
  deleteDocument: (workspaceId: string, docId: string) => Promise<void>;
  bulkDeleteDocuments: (workspaceId: string, docIds: string[]) => Promise<BulkDeleteResult>;
  deleteAllDocuments: (workspaceId: string) => Promise<void>;
  getDownloadUrl: (workspaceId: string, docId: string) => Promise<string>;
  reindexDocument: (workspaceId: string, docId: string) => Promise<void>;
  updateDocumentIndexingStatus: (documentId: string, indexingStatus: string, indexingError?: string, lastIndexedAt?: string) => void;

  // Template operations
  fetchTemplates: () => Promise<void>;
  createSetting: (data: CreateWorkspaceSettingData) => Promise<WorkspaceSetting>;

  // Workspace settings operations (for settings modal)
  fetchCurrentWorkspaceSettings: () => Promise<void>;
  updateCurrentWorkspaceSettings: (data: UpdateWorkspaceSettingData) => Promise<void>;
  assignSettingsToWorkspace: (settingsId: string) => Promise<void>;
  clearWorkspaceSettings: () => Promise<void>;

  // Cache management
  invalidateWorkspaceCache: () => void;
  invalidateDocumentCache: () => void;
  updateWorkspaceInCache: (workspace: Workspace) => void;
  refreshWorkspace: (workspaceId: string) => Promise<void>;

  // Error handling
  clearError: () => void;

  // Upload operations
  addFilesToQueue: (files: File[], workspaceId: string) => void;
  removeFromQueue: (fileId: string) => void;
  clearQueue: () => void;
  startUpload: () => Promise<void>;
  cancelUpload: (fileId: string) => void;
  updateUploadProgress: (fileId: string, progress: number) => void;
  updateUploadStatus: (fileId: string, status: UploadFileStatus, error?: string) => void;
  clearCompletedUploads: () => void;
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

// ===== Initial State =====

const initialState: WorkspaceState = {
  workspaces: new Map(),
  currentPage: 1,
  totalPages: 0,
  totalWorkspaces: 0,
  searchQuery: '',

  selectedWorkspaceId: null,
  selectedWorkspace: null,

  documents: new Map(),
  documentsCurrentPage: 1,
  documentsTotalPages: 0,
  totalDocuments: 0,
  documentSearchQuery: '',

  templates: [],

  settingsTargetWorkspace: null,
  currentWorkspaceSettings: null,
  isLoadingSettings: false,
  isSavingSettings: false,

  isModalOpen: false,
  isCreateModalOpen: false,
  isCreateTemplateModalOpen: false,
  isSettingsModalOpen: false,
  createModalStep: 1,
  createTemplateModalStep: 1,
  isMobileSidebarOpen: true,

  isLoadingWorkspaces: false,
  isLoadingDocuments: false,
  isLoadingTemplates: false,
  isCreating: false,
  isDeleting: false,

  error: null,

  uploadQueue: [],
  isUploading: false,
  uploadSessionId: null,
};

// ===== Store =====

export const useWorkspaceStore = create<WorkspaceStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ===== Modal Controls =====
      openModal: () => {
        set({ isModalOpen: true });
        // Fetch workspaces when modal opens
        get().fetchWorkspaces(1);
      },

      closeModal: () => {
        set({
          isModalOpen: false,
          selectedWorkspaceId: null,
          selectedWorkspace: null,
          documents: new Map(),
          documentsCurrentPage: 1,
          documentSearchQuery: '',
        });
      },

      openCreateModal: () => {
        set({
          isCreateModalOpen: true,
          createModalStep: 1,
        });
        // Fetch templates when opening create modal
        get().fetchTemplates();
      },

      closeCreateModal: () =>
        set({
          isCreateModalOpen: false,
          createModalStep: 1,
        }),

      openCreateTemplateModal: () => {
        set({
          isCreateTemplateModalOpen: true,
          createTemplateModalStep: 1,
        });
      },

      closeCreateTemplateModal: () =>
        set({
          isCreateTemplateModalOpen: false,
          createTemplateModalStep: 1,
        }),

      openSettingsModal: (workspace) => {
        // Set the target workspace for settings (independent from selected workspace)
        // Use provided workspace, or fall back to currently selected workspace
        const targetWorkspace = workspace || get().selectedWorkspace;
        set({
          settingsTargetWorkspace: targetWorkspace,
          isSettingsModalOpen: true,
        });
        // Fetch the workspace's settings
        get().fetchCurrentWorkspaceSettings();
      },
      closeSettingsModal: () =>
        set({
          isSettingsModalOpen: false,
          settingsTargetWorkspace: null,
          currentWorkspaceSettings: null,
        }),

      setCreateModalStep: (step) => set({ createModalStep: step }),
      setCreateTemplateModalStep: (step) => set({ createTemplateModalStep: step }),

      toggleMobileSidebar: () => set((state) => ({ isMobileSidebarOpen: !state.isMobileSidebarOpen })),

      closeMobileSidebar: () => set({ isMobileSidebarOpen: false }),

      // ===== Workspace Operations =====
      fetchWorkspaces: async (page = 1) => {
        const state = get();

        // Check cache first (skip if searching)
        if (!state.searchQuery && state.workspaces.has(page)) {
          set({ currentPage: page });
          return;
        }

        set({ isLoadingWorkspaces: true, error: null });

        try {
          const result = await workspaceApi.getWorkspaces({
            page,
            limit: DEFAULT_PAGE_LIMIT,
            search: state.searchQuery || undefined,
          });

          const newCache = new Map(state.searchQuery ? [] : state.workspaces);
          newCache.set(page, result.workspaces);

          set({
            workspaces: newCache,
            currentPage: page,
            totalPages: result.pagination.totalPages,
            totalWorkspaces: result.pagination.total,
            isLoadingWorkspaces: false,
          });

          const { isModalOpen, selectedWorkspaceId } = get();
          if (isModalOpen && !selectedWorkspaceId && result.workspaces.length > 0) {
            get()
              .selectWorkspace(result.workspaces[0].id)
              .catch((err) => {
                console.error('Failed to auto-select workspace', err);
              });
          }
        } catch (err) {
          const fallback = tError('fetchWorkspaces', 'Failed to fetch workspaces');
          const message = err instanceof Error ? err.message : fallback;
          set({ error: message, isLoadingWorkspaces: false });
        }
      },

      searchWorkspaces: async (query) => {
        set({
          searchQuery: query,
          workspaces: new Map(), // Clear cache on search
          currentPage: 1,
        });
        await get().fetchWorkspaces(1);
      },

      selectWorkspace: async (workspaceId) => {
        const state = get();

        // Skip if already selected
        if (state.selectedWorkspaceId === workspaceId) {
          return;
        }

        // Find workspace from cache for immediate display (optimistic UI)
        let cachedWorkspace: Workspace | null = null;
        for (const workspaces of state.workspaces.values()) {
          const found = workspaces.find((w) => w.id === workspaceId);
          if (found) {
            cachedWorkspace = found;
            break;
          }
        }

        set({
          selectedWorkspaceId: workspaceId,
          selectedWorkspace: cachedWorkspace, // Show cached data immediately
          isLoadingDocuments: true,
          documents: new Map(),
          documentsCurrentPage: 1,
          documentSearchQuery: '',
          isMobileSidebarOpen: false, // Close sidebar on mobile when selecting
        });

        try {
          // Fetch fresh workspace data in parallel with documents
          const [freshWorkspace] = await Promise.all([workspaceApi.getWorkspace(workspaceId), get().fetchDocuments(workspaceId, 1)]);

          // Update with fresh data (may have updated counts, storage, etc.)
          set({ selectedWorkspace: freshWorkspace });
        } catch (err) {
          const fallback = tError('loadWorkspace', 'Failed to load workspace');
          const message = err instanceof Error ? err.message : fallback;
          set({ error: message, isLoadingDocuments: false });
        }
      },

      createWorkspace: async (data) => {
        set({ isCreating: true, error: null });

        try {
          const workspace = await workspaceApi.createWorkspace(data);

          // Invalidate cache and refresh
          get().invalidateWorkspaceCache();
          await get().fetchWorkspaces(1);

          set({
            isCreating: false,
            isCreateModalOpen: false,
            createModalStep: 1,
          });

          toast.success(tToast('workspace.createSuccessTitle', 'Workspace created'), {
            description: tToast('workspace.createSuccessDescription', `"${workspace.name}" has been created successfully.`, { name: workspace.name }),
          });

          return workspace;
        } catch (err) {
          const fallback = tError('createWorkspace', 'Failed to create workspace');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message, isCreating: false });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      updateWorkspace: async (id, data) => {
        try {
          const updated = await workspaceApi.updateWorkspace(id, data);

          // Update in cache (create new arrays to ensure React detects changes)
          const state = get();
          const newCache = new Map(state.workspaces);
          newCache.forEach((workspaces, page) => {
            const index = workspaces.findIndex((w) => w.id === id);
            if (index !== -1) {
              const updatedWorkspaces = [...workspaces];
              updatedWorkspaces[index] = updated;
              newCache.set(page, updatedWorkspaces);
            }
          });

          set({
            workspaces: newCache,
            selectedWorkspace: state.selectedWorkspaceId === id ? updated : state.selectedWorkspace,
          });

          toast.success(tToast('workspace.updateSuccessTitle', 'Workspace updated'));
        } catch (err) {
          const fallback = tError('updateWorkspace', 'Failed to update workspace');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      deleteWorkspace: async (id) => {
        set({ isDeleting: true, error: null });

        try {
          await workspaceApi.deleteWorkspace(id);

          // Clear selection if deleted workspace was selected
          const state = get();
          if (state.selectedWorkspaceId === id) {
            set({ selectedWorkspaceId: null, selectedWorkspace: null });
          }

          // Invalidate cache and refresh
          get().invalidateWorkspaceCache();
          await get().fetchWorkspaces(1);

          // Remove deleted workspace from conversation store
          try {
            const { useConversationStore } = await import('@/modules/conversation/store');
            const convState = useConversationStore.getState();

            const updatedConversations = convState.conversations.map((c) => {
              if (c.workspaces?.includes(id)) {
                return { ...c, workspaces: c.workspaces.filter((wId) => wId !== id) };
              }
              return c;
            });

            const updatedCurrent = convState.currentConversation?.workspaces?.includes(id)
              ? {
                  ...convState.currentConversation,
                  workspaces: convState.currentConversation.workspaces.filter((wId) => wId !== id),
                }
              : convState.currentConversation;

            useConversationStore.setState({
              conversations: updatedConversations,
              currentConversation: updatedCurrent,
            });
          } catch {
            // Conversation store cleanup is best-effort
          }

          set({ isDeleting: false });
          toast.success(tToast('workspace.deleteSuccessTitle', 'Workspace deleted'));
        } catch (err) {
          const fallback = tError('deleteWorkspace', 'Failed to delete workspace');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message, isDeleting: false });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      renameWorkspace: async (id, name) => {
        await get().updateWorkspace(id, { name });
      },

      // ===== Document Operations =====
      fetchDocuments: async (workspaceId, page = 1) => {
        const state = get();

        // Check cache first (skip if searching)
        if (!state.documentSearchQuery && state.documents.has(page)) {
          set({ documentsCurrentPage: page });
          return;
        }

        set({ isLoadingDocuments: true, error: null });

        try {
          const result = await workspaceApi.getDocuments(workspaceId, {
            page,
            limit: DEFAULT_PAGE_LIMIT,
            search: state.documentSearchQuery || undefined,
          });

          const newCache = new Map(state.documentSearchQuery ? [] : state.documents);
          newCache.set(page, result.documents);

          set({
            documents: newCache,
            documentsCurrentPage: page,
            documentsTotalPages: result.pagination.totalPages,
            totalDocuments: result.pagination.total,
            isLoadingDocuments: false,
          });
        } catch (err) {
          const fallback = tError('fetchDocuments', 'Failed to fetch documents');
          const message = err instanceof Error ? err.message : fallback;
          set({ error: message, isLoadingDocuments: false });
        }
      },

      searchDocuments: async (query) => {
        const state = get();
        if (!state.selectedWorkspaceId) return;

        set({
          documentSearchQuery: query,
          documents: new Map(),
          documentsCurrentPage: 1,
        });
        await get().fetchDocuments(state.selectedWorkspaceId, 1);
      },

      deleteDocument: async (workspaceId, docId) => {
        try {
          await workspaceApi.deleteDocument(workspaceId, docId);

          // Invalidate cache and refresh documents
          get().invalidateDocumentCache();
          await get().fetchDocuments(workspaceId, 1);

          // Refresh workspace to update document count and storage in both sidebar and content
          await get().refreshWorkspace(workspaceId);

          toast.success(tToast('documents.deleteSuccessTitle', 'Document deleted'));
        } catch (err) {
          const fallback = tError('deleteDocument', 'Failed to delete document');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      bulkDeleteDocuments: async (workspaceId, docIds) => {
        set({ isDeleting: true, error: null });

        try {
          const result = await workspaceApi.bulkDeleteDocuments(workspaceId, docIds);

          // Invalidate cache and refresh documents
          get().invalidateDocumentCache();
          await get().fetchDocuments(workspaceId, 1);

          // Refresh workspace to update document count and storage in both sidebar and content
          await get().refreshWorkspace(workspaceId);

          set({ isDeleting: false });

          if (result.failed.length > 0) {
            toast.warning(
              tToast('documents.bulkDeletePartialTitle', 'Deleted {{count}} documents', { count: result.deleted }),
              {
                description: tToast('documents.bulkDeletePartialDescription', '{{count}} documents failed to delete.', {
                  count: result.failed.length,
                }),
              },
            );
          } else {
            toast.success(tToast('documents.bulkDeleteSuccessTitle', 'Deleted {{count}} documents', { count: result.deleted }));
          }

          return result;
        } catch (err) {
          const fallback = tError('deleteDocuments', 'Failed to delete documents');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message, isDeleting: false });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      deleteAllDocuments: async (workspaceId) => {
        set({ isDeleting: true, error: null });

        try {
          await workspaceApi.deleteAllDocuments(workspaceId);

          // Invalidate cache and refresh documents
          get().invalidateDocumentCache();
          await get().fetchDocuments(workspaceId, 1);

          // Refresh workspace to update document count and storage
          await get().refreshWorkspace(workspaceId);

          set({ isDeleting: false });
          toast.success(tToast('documents.deleteAllSuccessTitle', 'All documents deleted'));
        } catch (err) {
          const fallback = tError('deleteAllDocuments', 'Failed to delete all documents');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message, isDeleting: false });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      getDownloadUrl: async (workspaceId, docId) => {
        const response = await workspaceApi.getDocumentDownloadUrl(workspaceId, docId);
        return response.url;
      },

      reindexDocument: async (workspaceId, docId) => {
        try {
          const result = await workspaceApi.reindexDocument(workspaceId, docId);

          // Merge only the returned fields into the existing document
          const state = get();
          const newCache = new Map(state.documents);
          newCache.forEach((documents, page) => {
            const index = documents.findIndex((d) => d.id === docId);
            if (index !== -1) {
              const updatedDocuments = [...documents];
              updatedDocuments[index] = { ...documents[index], ...result };
              newCache.set(page, updatedDocuments);
            }
          });

          set({ documents: newCache });
          toast.success(tToast('documents.reindexStartTitle', 'Re-indexing started'), {
            description: tToast('documents.reindexStartDescription', 'Document will be re-indexed shortly.'),
          });
        } catch (err) {
          const fallback = tError('reindexDocument', 'Failed to re-index document');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      updateDocumentIndexingStatus: (documentId, indexingStatus, indexingError, lastIndexedAt) => {
        const state = get();
        const newCache = new Map(state.documents);
        let found = false;

        newCache.forEach((documents, page) => {
          const index = documents.findIndex((d) => d.id === documentId);
          if (index !== -1) {
            found = true;
            const updatedDocuments = [...documents];
            updatedDocuments[index] = {
              ...updatedDocuments[index],
              indexingStatus: indexingStatus as WorkspaceDocument['indexingStatus'],
              indexingError,
              lastIndexedAt,
            };
            newCache.set(page, updatedDocuments);
          }
        });

        if (found) {
          set({ documents: newCache });
        }
      },

      // ===== Template Operations =====
      fetchTemplates: async () => {
        set({ isLoadingTemplates: true });

        try {
          const result = await workspaceApi.getWorkspaceSettingTemplates({
            limit: 100, // Get all templates
          });
          // Sort predefined templates first (backend already does this, but ensure consistency)
          const sortedTemplates = [...result.settings].sort((a, b) => {
            if (a.isPredefined && !b.isPredefined) return -1;
            if (!a.isPredefined && b.isPredefined) return 1;
            return 0;
          });
          set({ templates: sortedTemplates, isLoadingTemplates: false });
        } catch (err) {
          console.error('Failed to fetch templates:', err);
          set({ isLoadingTemplates: false });
        }
      },

      createSetting: async (data) => {
        try {
          const setting = await workspaceApi.createWorkspaceSetting(data);

          // Refresh templates if it's a template
          if (data.isTemplate) {
            await get().fetchTemplates();
            toast.success(tToast('template.createSuccessTitle', 'Template created'), {
              description: tToast('template.createSuccessDescription', `"${setting.name}" has been created successfully.`, {
                name: setting.name,
              }),
            });
          }

          return setting;
        } catch (err) {
          const fallback = tError('createSetting', 'Failed to create setting');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      // ===== Workspace Settings Operations =====
      // Note: These operations use settingsTargetWorkspace, not selectedWorkspace
      // This allows viewing/editing settings without selecting the workspace
      fetchCurrentWorkspaceSettings: async () => {
        const state = get();
        const workspace = state.settingsTargetWorkspace;

        if (!workspace) {
          set({ currentWorkspaceSettings: null, isLoadingSettings: false });
          return;
        }

        // If workspace has no settings, set to null
        if (!workspace.settings) {
          set({ currentWorkspaceSettings: null, isLoadingSettings: false });
          return;
        }

        set({ isLoadingSettings: true });

        try {
          const settings = await workspaceApi.getWorkspaceSetting(workspace.settings);
          set({ currentWorkspaceSettings: settings, isLoadingSettings: false });
        } catch (err) {
          console.error('Failed to fetch workspace settings:', err);
          set({ currentWorkspaceSettings: null, isLoadingSettings: false });
        }
      },

      updateCurrentWorkspaceSettings: async (data) => {
        const state = get();
        const settings = state.currentWorkspaceSettings;
        const workspace = state.settingsTargetWorkspace;

        if (!settings || !workspace) return;

        set({ isSavingSettings: true });

        try {
          const updated = await workspaceApi.updateWorkspaceSetting(settings.id, data);
          set({ currentWorkspaceSettings: updated, isSavingSettings: false });
          toast.success(tToast('settings.updateSuccessTitle', 'Settings updated'));
        } catch (err) {
          const fallback = tError('updateSettings', 'Failed to update settings');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message, isSavingSettings: false });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      assignSettingsToWorkspace: async (settingsId) => {
        const state = get();
        const workspace = state.settingsTargetWorkspace;

        if (!workspace) return;

        set({ isSavingSettings: true });

        try {
          await get().updateWorkspace(workspace.id, { settings: settingsId });
          // Update the target workspace reference with new settings
          set({
            settingsTargetWorkspace: { ...workspace, settings: settingsId },
          });
          // Fetch the new settings to display
          const settings = await workspaceApi.getWorkspaceSetting(settingsId);
          set({ currentWorkspaceSettings: settings, isSavingSettings: false });
          toast.success(tToast('settings.applySuccessTitle', 'Settings applied'));
        } catch (err) {
          const fallback = tError('applySettings', 'Failed to apply settings');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message, isSavingSettings: false });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      clearWorkspaceSettings: async () => {
        const state = get();
        const workspace = state.settingsTargetWorkspace;

        if (!workspace) return;

        set({ isSavingSettings: true });

        try {
          await get().updateWorkspace(workspace.id, { settings: null });
          // Update the target workspace reference
          set({
            settingsTargetWorkspace: { ...workspace, settings: undefined },
            currentWorkspaceSettings: null,
            isSavingSettings: false,
          });
          toast.success(tToast('settings.clearSuccessTitle', 'Settings cleared'), {
            description: tToast('settings.clearSuccessDescription', 'Workspace will use default settings.'),
          });
        } catch (err) {
          const fallback = tError('clearSettings', 'Failed to clear settings');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message, isSavingSettings: false });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      // ===== Cache Management =====
      invalidateWorkspaceCache: () => {
        set({ workspaces: new Map(), currentPage: 1 });
      },

      invalidateDocumentCache: () => {
        set({ documents: new Map(), documentsCurrentPage: 1 });
      },

      /**
       * Update a workspace in both selectedWorkspace and the workspaces cache
       * This ensures the sidebar and content area stay in sync
       */
      updateWorkspaceInCache: (workspace: Workspace) => {
        const state = get();

        // Update selectedWorkspace if it matches
        const newSelectedWorkspace = state.selectedWorkspaceId === workspace.id ? workspace : state.selectedWorkspace;

        // Update workspace in the cache
        const newWorkspacesCache = new Map(state.workspaces);
        newWorkspacesCache.forEach((workspaces, page) => {
          const index = workspaces.findIndex((w) => w.id === workspace.id);
          if (index !== -1) {
            const updatedWorkspaces = [...workspaces];
            updatedWorkspaces[index] = workspace;
            newWorkspacesCache.set(page, updatedWorkspaces);
          }
        });

        set({
          selectedWorkspace: newSelectedWorkspace,
          workspaces: newWorkspacesCache,
        });
      },

      /**
       * Refresh workspace data from API and update cache
       */
      refreshWorkspace: async (workspaceId: string) => {
        try {
          const workspace = await workspaceApi.getWorkspace(workspaceId);
          get().updateWorkspaceInCache(workspace);
        } catch (err) {
          console.error('Failed to refresh workspace:', err);
        }
      },

      // ===== Error Handling =====
      clearError: () => set({ error: null }),

      // ===== Upload Operations =====
      addFilesToQueue: (files, workspaceId) => {
        const newItems: UploadQueueItem[] = files.map((file) => ({
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          file,
          workspaceId,
          status: 'pending' as UploadFileStatus,
          progress: 0,
        }));

        set((state) => ({
          uploadQueue: [...state.uploadQueue, ...newItems],
        }));
      },

      removeFromQueue: (fileId) => {
        set((state) => ({
          uploadQueue: state.uploadQueue.filter((item) => item.id !== fileId),
        }));
      },

      clearQueue: () => {
        set({ uploadQueue: [], uploadSessionId: null });
      },

      startUpload: async () => {
        const state = get();
        const pendingFiles = state.uploadQueue.filter((item) => item.status === 'pending');

        if (pendingFiles.length === 0) return;

        set({ isUploading: true });

        const workspaceId = pendingFiles[0].workspaceId;
        const SMALL_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

        try {
          // Check if single small file or multiple/large files
          const isSingleSmallFile = pendingFiles.length === 1 && pendingFiles[0].file.size < SMALL_FILE_THRESHOLD;

          if (isSingleSmallFile) {
            // Direct upload for single small file
            const item = pendingFiles[0];
            get().updateUploadStatus(item.id, 'uploading');

            try {
              await workspaceApi.uploadSmallFile(workspaceId, item.file, (progress) => get().updateUploadProgress(item.id, progress));
              get().updateUploadStatus(item.id, 'completed');
              toast.success(tToast('upload.successTitle', 'Upload complete'), {
                description: tToast('upload.singleSuccessDescription', '"{{name}}" has been uploaded.', { name: item.file.name }),
              });
            } catch (err) {
              const fallbackUpload = tError('uploadFailed', 'Upload failed');
              const message = getApiErrorMessage(err, fallbackUpload);
              get().updateUploadStatus(item.id, 'failed', message);
              toast.error(fallbackUpload, { description: message });
            }
          } else {
            // Bulk upload for multiple or large files
            const fileRequests = pendingFiles.map((item) => ({
              filename: item.file.name,
              mimeType: item.file.type || 'application/octet-stream',
              size: item.file.size,
            }));

            // Mark all as uploading
            pendingFiles.forEach((item) => {
              get().updateUploadStatus(item.id, 'uploading');
            });

            // Initiate bulk session
            const session = await workspaceApi.initiateBulkUpload(workspaceId, {
              files: fileRequests,
            });

            set({ uploadSessionId: session.sessionId });

            // Track upload results
            let successCount = 0;
            let failCount = 0;

            // Upload each file to Azure in parallel
            const uploadPromises = session.files.map(async (fileInfo, index) => {
              const item = pendingFiles[index];
              if (!item) return { success: false };

              try {
                await workspaceApi.uploadToAzure(fileInfo.uploadUrl, item.file, (progress) => {
                  // Track progress locally - no need to send to backend
                  get().updateUploadProgress(item.id, progress);
                });

                get().updateUploadStatus(item.id, 'completed');
                successCount++;
                return { success: true };
              } catch (err) {
                const fallbackUpload = tError('uploadFailed', 'Upload failed');
                const message = getApiErrorMessage(err, fallbackUpload);
                get().updateUploadStatus(item.id, 'failed', message);
                failCount++;
                return { success: false, error: message };
              }
            });

            await Promise.allSettled(uploadPromises);

            // Always complete the bulk session so backend can finalize
            // Backend will verify which files actually made it to Azure
            try {
              await workspaceApi.completeBulkUpload(workspaceId, session.sessionId);
            } catch (err) {
              console.error('Failed to complete bulk upload session:', err);
            }

            // Show toast with results
            if (failCount === 0) {
              toast.success(tToast('upload.successTitle', 'Upload complete'), {
                description: tToast('upload.bulkSuccessDescription', '{{count}} file(s) uploaded successfully.', { count: successCount }),
              });
            } else if (successCount === 0) {
              const fallbackUpload = tError('uploadFailed', 'Upload failed');
              toast.error(fallbackUpload, {
                description: tToast('upload.bulkErrorDescription', 'All {{count}} files failed to upload.', { count: failCount }),
              });
            } else {
              toast.warning(tToast('upload.partialTitle', 'Upload partially complete'), {
                description: tToast('upload.partialDescription', '{{success}} succeeded, {{failed}} failed.', {
                  success: successCount,
                  failed: failCount,
                }),
              });
            }
          }

          // Refresh documents list and workspace data after upload
          const selectedId = get().selectedWorkspaceId;
          if (selectedId === workspaceId) {
            get().invalidateDocumentCache();
            await get().fetchDocuments(workspaceId, 1);
          }

          // Refresh workspace to update document count and storage in both sidebar and content
          await get().refreshWorkspace(workspaceId);
        } catch (err) {
          const fallbackUpload = tError('uploadFailed', 'Upload failed');
          const message = getApiErrorMessage(err, fallbackUpload);
          set({ error: message });

          // Mark all pending as failed
          pendingFiles.forEach((item) => {
            if (get().uploadQueue.find((q) => q.id === item.id)?.status === 'uploading') {
              get().updateUploadStatus(item.id, 'failed', message);
            }
          });
        } finally {
          set({ isUploading: false, uploadSessionId: null });
        }
      },

      cancelUpload: (fileId) => {
        // For now, just remove from queue if pending
        // Full cancellation of in-progress uploads would require XHR abort
        const item = get().uploadQueue.find((i) => i.id === fileId);
        if (item?.status === 'pending') {
          get().removeFromQueue(fileId);
        }
      },

      updateUploadProgress: (fileId, progress) => {
        set((state) => ({
          uploadQueue: state.uploadQueue.map((item) => (item.id === fileId ? { ...item, progress } : item)),
        }));
      },

      updateUploadStatus: (fileId, status, error) => {
        set((state) => ({
          uploadQueue: state.uploadQueue.map((item) => (item.id === fileId ? { ...item, status, error, progress: status === 'completed' ? 100 : item.progress } : item)),
        }));
      },

      clearCompletedUploads: () => {
        set((state) => ({
          uploadQueue: state.uploadQueue.filter((item) => item.status !== 'completed' && item.status !== 'failed'),
        }));
      },
    }),
    { name: 'workspace-store' },
  ),
);

// ===== Selector Hooks for Performance =====

export const useWorkspaces = () => {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const currentPage = useWorkspaceStore((state) => state.currentPage);
  return workspaces.get(currentPage) || [];
};

export const useDocuments = () => {
  const documents = useWorkspaceStore((state) => state.documents);
  const currentPage = useWorkspaceStore((state) => state.documentsCurrentPage);
  return documents.get(currentPage) || [];
};

export const useSelectedWorkspace = () => useWorkspaceStore((state) => state.selectedWorkspace);

export const useWorkspaceModalState = () => useWorkspaceStore(
  useShallow((state) => ({
    isModalOpen: state.isModalOpen,
    isCreateModalOpen: state.isCreateModalOpen,
    isCreateTemplateModalOpen: state.isCreateTemplateModalOpen,
    isSettingsModalOpen: state.isSettingsModalOpen,
    createModalStep: state.createModalStep,
    createTemplateModalStep: state.createTemplateModalStep,
    isMobileSidebarOpen: state.isMobileSidebarOpen,
  })),
);

export const useWorkspaceLoading = () => useWorkspaceStore(
  useShallow((state) => ({
    isLoadingWorkspaces: state.isLoadingWorkspaces,
    isLoadingDocuments: state.isLoadingDocuments,
    isLoadingTemplates: state.isLoadingTemplates,
    isLoadingSettings: state.isLoadingSettings,
    isSavingSettings: state.isSavingSettings,
    isCreating: state.isCreating,
    isDeleting: state.isDeleting,
  })),
);

export const useCurrentWorkspaceSettings = () => useWorkspaceStore((state) => state.currentWorkspaceSettings);

export const useSettingsTargetWorkspace = () => useWorkspaceStore((state) => state.settingsTargetWorkspace);

export const useWorkspacePagination = () => useWorkspaceStore(
  useShallow((state) => ({
    currentPage: state.currentPage,
    totalPages: state.totalPages,
    totalWorkspaces: state.totalWorkspaces,
  })),
);

export const useDocumentPagination = () => useWorkspaceStore(
  useShallow((state) => ({
    currentPage: state.documentsCurrentPage,
    totalPages: state.documentsTotalPages,
    totalDocuments: state.totalDocuments,
  })),
);

export const useUploadQueue = () => useWorkspaceStore(useShallow((state) => state.uploadQueue));

export const useUploadState = () => useWorkspaceStore(
  useShallow((state) => ({
    uploadQueue: state.uploadQueue,
    isUploading: state.isUploading,
    uploadSessionId: state.uploadSessionId,
  })),
);

export const useHasActiveUploads = () => {
  const queue = useWorkspaceStore((state) => state.uploadQueue);
  return queue.some((item) => item.status === 'pending' || item.status === 'uploading');
};
