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
import type { Workspace, WorkspaceDocument, WorkspaceSetting, CreateWorkspaceData, UpdateWorkspaceData, CreateWorkspaceSettingData, UpdateWorkspaceSettingData, BulkDeleteResult, UploadQueueItem, UploadFileStatus, CreateFolderData, RenameFolderData, DocumentQueryParams } from './types';

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
    return workspaceTranslator(getWorkspaceTranslationKey(segment), params) ?? fallback;
  }
  return fallback;
};

const tError = (key: string, fallback: string) => translateWorkspaceString(`errors.${key}`, fallback);
const tToast = (key: string, fallback: string, params?: TranslationParams) => translateWorkspaceString(`toast.${key}`, fallback, params);

// ===== Initial State =====

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
  currentFolderId: string | null; // Current folder being viewed
  lastFetchedFolderId: string | null; // Last folder ID for which documents were fetched
  allFolders: WorkspaceDocument[]; // All folders for sidebar tree view

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
  setCurrentFolderId: (folderId: string | null) => void;
  fetchAllFolders: (workspaceId: string) => Promise<void>;
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
  invalidateDocumentData: () => void; // Invalidate only documents, keep currentFolderId
  updateWorkspaceInCache: (workspace: Workspace) => void;
  refreshWorkspace: (workspaceId: string) => Promise<void>;
  removeFolderFromCache: (folderId: string) => void;

  // Error handling
  clearError: () => void;

  // Upload operations
  addFilesToQueue: (files: File[], workspaceId: string, folderId?: string) => void;
  removeFromQueue: (fileId: string) => void;
  clearQueue: () => void;
  startUpload: () => Promise<void>;
  cancelUpload: (fileId: string) => void;
  updateUploadProgress: (fileId: string, progress: number) => void;
  updateUploadStatus: (fileId: string, status: UploadFileStatus, error?: string) => void;
  clearCompletedUploads: () => void;

  // Folder operations
  createFolder: (workspaceId: string, data: CreateFolderData) => Promise<WorkspaceDocument>;
  renameFolder: (workspaceId: string, folderId: string, data: RenameFolderData) => Promise<WorkspaceDocument>;
  deleteFolder: (workspaceId: string, folderId: string) => Promise<{ deletedFolders: number; deletedDocuments: number }>;
  getFolderContents: (workspaceId: string, folderId: string, params?: DocumentQueryParams) => Promise<void>;
  moveDocuments: (workspaceId: string, documentIds: string[], targetFolderId?: string) => Promise<{ moved: number; failed: string[] }>;
  getPersonalWorkspace: () => Promise<void>;
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
  currentFolderId: null,
  lastFetchedFolderId: null,
  allFolders: [],

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
          allFolders: [],
          currentFolderId: null,
          lastFetchedFolderId: null,
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
        set({
          settingsTargetWorkspace: workspace || get().selectedWorkspace,
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
          // Fetch regular workspaces and personal workspace in parallel
          const [result, personalWorkspace] = await Promise.all([
            workspaceApi.getWorkspaces({
              page,
              limit: DEFAULT_PAGE_LIMIT,
              search: state.searchQuery || undefined,
            }),
            workspaceApi.getPersonalWorkspace().catch(() => null),
          ]);

          // Combine results - personal workspace first if it exists
          let allWorkspaces = result.workspaces;
          if (personalWorkspace) {
            // Remove personal workspace from list if it exists, then add it at the beginning
            allWorkspaces = allWorkspaces.filter((w) => w.id !== personalWorkspace.id);
            allWorkspaces = [personalWorkspace, ...allWorkspaces];
          }

          const newCache = new Map(state.searchQuery ? [] : state.workspaces);
          newCache.set(page, allWorkspaces);

          set({
            workspaces: newCache,
            currentPage: page,
            totalPages: result.pagination.totalPages,
            totalWorkspaces: result.pagination.total + (personalWorkspace ? 1 : 0),
            isLoadingWorkspaces: false,
          });

          const { selectedWorkspaceId } = get();
          // Auto-select first workspace (personal) when no workspace is selected
          // This ensures the personal workspace is selected by default when modal opens
          if (!selectedWorkspaceId && allWorkspaces.length > 0) {
            get()
              .selectWorkspace(allWorkspaces[0].id)
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
          selectedWorkspace: cachedWorkspace,
          isLoadingDocuments: true,
          documents: new Map(),
          documentsCurrentPage: 1,
          documentSearchQuery: '',
          currentFolderId: null,
          lastFetchedFolderId: null,
          allFolders: [],
          isMobileSidebarOpen: false, // Close sidebar on mobile when selecting
        });

        try {
          // Fetch fresh workspace data, documents, and folders in parallel
          const [freshWorkspace] = await Promise.all([workspaceApi.getWorkspace(workspaceId), get().fetchDocuments(workspaceId, 1), get().fetchAllFolders(workspaceId)]);

          // Update with fresh data (may have updated counts, storage, etc.)
          set({
            selectedWorkspace: freshWorkspace,
            isLoadingDocuments: false,
          });
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
            description: tToast('workspace.createSuccessDescription', `"${data.name}" has been created successfully.`, { name: data.name }),
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
            set({
              selectedWorkspaceId: null,
              selectedWorkspace: null,
            });
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
                  workspaces: convState.currentConversation.workspaces?.filter((wId) => wId !== id),
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

        const folderChanged = state.currentFolderId !== state.lastFetchedFolderId;
        const targetPage = folderChanged ? 1 : page;

        if (!state.documentSearchQuery && !folderChanged && state.documents.has(targetPage)) {
          set({ documentsCurrentPage: targetPage });
          return;
        }

        if (folderChanged) {
          set({
            documents: new Map(),
            documentsCurrentPage: 1,
          });
        }

        set({ isLoadingDocuments: true, error: null });

        try {
          const result = await workspaceApi.getDocuments(workspaceId, {
            page: targetPage,
            limit: DEFAULT_PAGE_LIMIT,
            search: state.documentSearchQuery || undefined,
            parentId: state.currentFolderId,
          });

          const newCache = new Map(state.documentSearchQuery ? [] : state.documents);
          newCache.set(targetPage, result.documents);

          set({
            documents: newCache,
            documentsCurrentPage: targetPage,
            documentsTotalPages: result.pagination.totalPages,
            totalDocuments: result.pagination.total,
            lastFetchedFolderId: state.currentFolderId,
            isLoadingDocuments: false,
          });
        } catch (err) {
          const fallback = tError('fetchDocuments', 'Failed to fetch documents');
          const message = err instanceof Error ? err.message : fallback;
          set({ error: message, isLoadingDocuments: false });
        }
      },

      setCurrentFolderId: (folderId) => {
        set({
          currentFolderId: folderId,
          lastFetchedFolderId: null,
          documents: new Map(),
          documentsCurrentPage: 1,
          documentsTotalPages: 0,
          totalDocuments: 0,
        });
      },

      fetchAllFolders: async (workspaceId: string) => {
        try {
          const folders = await workspaceApi.getAllFolders(workspaceId);
          set({ allFolders: folders });
        } catch (err) {
          console.error('Failed to fetch all folders:', err);
        }
      },

      removeFolderFromCache: (folderId: string) => {
        const state = get();
        const folderIdsToRemove = new Set<string>([folderId]);

        let changed = true;
        while (changed) {
          changed = false;
          for (const folder of state.allFolders) {
            if (folder.parentId && folderIdsToRemove.has(folder.parentId) && !folderIdsToRemove.has(folder.id)) {
              folderIdsToRemove.add(folder.id);
              changed = true;
            }
          }
        }

        const filteredFolders = state.allFolders.filter((folder) => !folderIdsToRemove.has(folder.id));
        const filteredDocuments = new Map<number, WorkspaceDocument[]>();

        state.documents.forEach((documents, page) => {
          filteredDocuments.set(
            page,
            documents.filter((document) => !(document.isFolder && folderIdsToRemove.has(document.id))),
          );
        });

        const shouldResetCurrentFolder = state.currentFolderId ? folderIdsToRemove.has(state.currentFolderId) : false;

        set({
          allFolders: filteredFolders,
          documents: filteredDocuments,
          currentFolderId: shouldResetCurrentFolder ? null : state.currentFolderId,
          lastFetchedFolderId: shouldResetCurrentFolder ? null : state.lastFetchedFolderId,
        });
      },

      searchDocuments: async (query) => {
        set({
          documentSearchQuery: query,
          lastFetchedFolderId: null,
          documents: new Map(), // Clear cache on search
          documentsCurrentPage: 1,
        });
        await get().fetchDocuments(get().selectedWorkspaceId || '', 1);
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

          if (result.failed.length > 0) {
            toast.warning(tToast('documents.bulkDeletePartialTitle', 'Deleted {{count}} documents', { count: result.deleted }), {
              description: tToast('documents.bulkDeletePartialDescription', '{{count}} documents failed to delete.', { count: result.failed.length }),
            });
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

          // Refresh workspace to update document count and storage in both sidebar and content
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

          // Merge only returned fields into existing document
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
        newCache.forEach((documents, page) => {
          const index = documents.findIndex((d) => d.id === documentId);
          if (index !== -1) {
            const updatedDocuments = [...documents];
            updatedDocuments[index] = {
              ...documents[index],
              indexingStatus: indexingStatus as WorkspaceDocument['indexingStatus'],
              indexingError,
              lastIndexedAt,
            };
            newCache.set(page, updatedDocuments);
          }
        });

        set({ documents: newCache });
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
            if (a.isPredefined && !b.isPredefined) {
              return -1;
            }
            if (!a.isPredefined && !b.isPredefined) {
              return 1;
            }
            return 0;
          });
          set({
            templates: sortedTemplates,
            isLoadingTemplates: false,
          });
        } catch (err) {
          set({ isLoadingTemplates: false });
        }
      },

      createSetting: async (data) => {
        try {
          const setting = await workspaceApi.createWorkspaceSetting(data);

          // Refresh templates if it's a template
          if (data.isTemplate) {
            await get().fetchTemplates();
          }

          toast.success(tToast('template.createSuccessTitle', 'Template created'), {
            description: tToast('template.createSuccessDescription', `"${data.name}" has been created successfully.`, { name: data.name }),
          });

          return setting;
        } catch (err) {
          const fallback = tError('createSetting', 'Failed to create setting');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      // ===== Workspace Settings Operations (for settings modal) =====
      fetchCurrentWorkspaceSettings: async () => {
        const workspace = get().settingsTargetWorkspace;
        if (!workspace) {
          set({ currentWorkspaceSettings: null, isLoadingSettings: false });
          return;
        }

        set({ isLoadingSettings: true, error: null });

        try {
          // If workspace has no settings, set to null
          if (!workspace.settings) {
            set({ currentWorkspaceSettings: null, isLoadingSettings: false });
            return;
          }

          const settings = await workspaceApi.getWorkspaceSetting(workspace.settings);
          set({ currentWorkspaceSettings: settings, isLoadingSettings: false });
        } catch (err) {
          const fallback = tError('fetchSettings', 'Failed to fetch workspace settings');
          const message = err instanceof Error ? err.message : fallback;
          set({ error: message, isLoadingSettings: false });
          toast.error(fallback, { description: message });
        }
      },

      updateCurrentWorkspaceSettings: async (data) => {
        const settingsId = get().settingsTargetWorkspace?.settings;
        if (!settingsId) {
          throw new Error('No settings ID found');
        }
        set({ isSavingSettings: true, error: null });

        try {
          const updated = await workspaceApi.updateWorkspaceSetting(settingsId, data);
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
        try {
          await get().updateWorkspace(get().settingsTargetWorkspace!.id, {
            settings: settingsId,
          });
          // Fetch the updated workspace settings
          await get().fetchCurrentWorkspaceSettings();
          toast.success(tToast('settings.applySuccessTitle', 'Settings applied'));
        } catch (err) {
          const fallback = tError('applySettings', 'Failed to apply settings');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      clearWorkspaceSettings: () => {
        set({
          currentWorkspaceSettings: null,
        });
      },

      // ===== Cache Management =====
      invalidateWorkspaceCache: () => {
        set({
          workspaces: new Map(),
          currentPage: 1,
          totalPages: 0,
          totalWorkspaces: 0,
        });
      },

      invalidateDocumentCache: () => {
        set({
          documents: new Map(),
          documentsCurrentPage: 1,
          documentsTotalPages: 0,
          totalDocuments: 0,
          documentSearchQuery: '',
          lastFetchedFolderId: null,
        });
      },

      invalidateDocumentData: () => {
        set({
          documents: new Map(),
          documentsCurrentPage: 1,
          documentsTotalPages: 0,
          totalDocuments: 0,
          documentSearchQuery: '',
          lastFetchedFolderId: null,
        });
      },

      updateWorkspaceInCache: (workspace) => {
        const state = get();
        const newCache = new Map(state.workspaces);
        newCache.forEach((workspaces, page) => {
          const index = workspaces.findIndex((w) => w.id === workspace.id);
          if (index !== -1) {
            const updatedWorkspaces = [...workspaces];
            updatedWorkspaces[index] = workspace;
            newCache.set(page, updatedWorkspaces);
          }
        });

          set({
            workspaces: newCache,
            selectedWorkspace: state.selectedWorkspaceId === workspace.id ? workspace : state.selectedWorkspace,
            totalDocuments: workspace.isPersonal ? Math.max(0, workspace.documentCount) : state.totalDocuments,
          });
      },

      refreshWorkspace: async (workspaceId) => {
        try {
          const workspace = await workspaceApi.getWorkspace(workspaceId);
          const documentCount = workspace.isPersonal ? get().totalDocuments : workspace.documentCount;
          get().updateWorkspaceInCache({
            ...workspace,
            documentCount: Math.max(0, documentCount),
          });
        } catch (err) {
          console.error('Failed to refresh workspace', err);
        }
      },

      // ===== Error Handling =====
      clearError: () => set({ error: null }),

      // ===== Upload Operations =====
      addFilesToQueue: (files, workspaceId, folderId) => {
        const newItems: UploadQueueItem[] = files.map((file) => ({
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          file,
          workspaceId,
          folderId,
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

        if (pendingFiles.length === 0) {
          return;
        }

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
              await workspaceApi.uploadSmallFile(
                workspaceId,
                item.file,
                (progress: number) => {
                  get().updateUploadProgress(item.id, progress);
                },
                item.folderId,
              );
              get().updateUploadStatus(item.id, 'completed');

              // Invalidate cache and refresh documents and folders
              const currentFolderId = get().currentFolderId;
              if (currentFolderId === (item.folderId || null)) {
                get().invalidateDocumentData();
                await Promise.all([get().fetchAllFolders(workspaceId), get().fetchDocuments(workspaceId, 1)]);
              }

              toast.success(tToast('upload.successTitle', 'Upload complete'), {
                description: tToast('upload.singleSuccessDescription', `"${item.file.name}" has been uploaded successfully.`, { name: item.file.name }),
              });
            } catch (err) {
              get().updateUploadStatus(item.id, 'failed', err instanceof Error ? err.message : 'Unknown error');
              const fallbackUpload = tError('uploadFailed', 'Upload failed');
              const message = getApiErrorMessage(err, fallbackUpload);
              toast.error(fallbackUpload, { description: message });
            }
          } else {
            // Bulk upload for multiple or large files
            const fileRequests = pendingFiles.map((item) => ({
              filename: item.file.name,
              mimeType: item.file.type,
              size: item.file.size,
            }));

            // Mark all as uploading
            pendingFiles.forEach((item) => {
              get().updateUploadStatus(item.id, 'uploading');
            });

            const session = await workspaceApi.initiateBulkUpload(workspaceId, {
              files: fileRequests,
            });

            set({ uploadSessionId: session.sessionId });

            // Upload each file to Azure in parallel
            let successCount = 0;
            let failCount = 0;

            const uploadPromises = session.files.map(async (fileInfo, index) => {
              const item = pendingFiles[index];
              try {
                await workspaceApi.uploadToAzure(fileInfo.uploadUrl, item.file, (progress) => {
                  get().updateUploadProgress(item.id, progress);
                });

                get().updateUploadStatus(item.id, 'completed');
                successCount++;
              } catch (err) {
                get().updateUploadStatus(item.id, 'failed', err instanceof Error ? err.message : 'Unknown error');
                failCount++;
              }
            });

            await Promise.all(uploadPromises);

            // Always complete bulk session so backend can finalize
            try {
              await workspaceApi.completeBulkUpload(workspaceId, session.sessionId);

              if (failCount === 0) {
                toast.success(tToast('upload.successTitle', 'Upload complete'), {
                  description: tToast('upload.bulkSuccessDescription', '{{count}} file(s) uploaded successfully.', { count: successCount }),
                });
              } else if (successCount === 0) {
                toast.error(tToast('upload.failedTitle', 'Upload failed'), {
                  description: tToast('upload.bulkErrorDescription', 'All {{count}} files failed to upload.', { count: failCount }),
                });
              } else {
                toast.warning(tToast('upload.partialTitle', 'Upload partially complete'), {
                  description: tToast('upload.partialDescription', '{{success}} succeeded, {{failed}} failed to upload.', { success: successCount, failed: failCount }),
                });
              }
            } catch (err) {
              console.error('Failed to complete bulk upload session', err);
            }

            // Refresh documents list and workspace data after upload
            const selectedId = get().selectedWorkspaceId;
            if (selectedId === workspaceId) {
              get().invalidateDocumentCache();
              await get().fetchDocuments(workspaceId, 1);
              await get().fetchAllFolders(workspaceId);
            }

            await get().refreshWorkspace(workspaceId);
          }
        } catch (err) {
          const fallbackUpload = tError('uploadFailed', 'Upload failed');
          const message = getApiErrorMessage(err, fallbackUpload);
          set({ error: message, isUploading: false });

          // Mark all pending as failed
          pendingFiles.forEach((item) => {
            if (get().uploadQueue.find((q) => q.id === item.id)?.status === 'uploading') {
              get().updateUploadStatus(item.id, 'failed', message);
            }
          });
        } finally {
          set({ isUploading: false, uploadSessionId: null });
          get().clearCompletedUploads();
        }
      },

      cancelUpload: (fileId) => {
        const item = get().uploadQueue.find((q) => q.id === fileId);
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

      // ===== Folder Operations =====
      createFolder: async (workspaceId, data) => {
        try {
          const folder = await workspaceApi.createFolder(workspaceId, data);
          toast.success(tToast('folder.createSuccessTitle', 'Folder created'), {
            description: tToast('folder.createSuccessDescription', `"${data.name}" has been created successfully.`, { name: data.name }),
          });

          // Optimistic update: add folder to the current folder listing immediately
          const state = get();
          const parentId = data.parentId || null;
          if (state.currentFolderId === parentId) {
            const currentPageDocs = state.documents.get(state.documentsCurrentPage) ?? [];
            const newCache = new Map(state.documents);
            newCache.set(state.documentsCurrentPage, [folder, ...currentPageDocs]);
            set({ documents: newCache });
          }

          if (parentId === null) {
            const newFolders = [...state.allFolders];
            newFolders.unshift(folder);
            set({ allFolders: newFolders });
          } else {
            // Refresh tree data so nested folders appear immediately in the sidebar
            await get().fetchAllFolders(workspaceId);
          }

          return folder;
        } catch (err) {
          const fallback = tError('createFolder', 'Failed to create folder');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      renameFolder: async (workspaceId, folderId, data) => {
        try {
          const folder = await workspaceApi.renameFolder(workspaceId, folderId, data);
          toast.success(tToast('folder.renameSuccessTitle', 'Folder renamed'), {
            description: tToast('folder.renameSuccessDescription', `"${data.name}" has been renamed successfully.`, { name: data.name }),
          });
          return folder;
        } catch (err) {
          const fallback = tError('renameFolder', 'Failed to rename folder');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      deleteFolder: async (workspaceId, folderId) => {
        set({ isDeleting: true, error: null });

        try {
          const result = await workspaceApi.deleteFolder(workspaceId, folderId);
          get().removeFolderFromCache(folderId);
          await Promise.all([get().fetchAllFolders(workspaceId), get().fetchDocuments(workspaceId, 1)]);
          await get().refreshWorkspace(workspaceId);

          set({ isDeleting: false });
          toast.success(tToast('folder.deleteSuccessTitle', 'Folder deleted'), {
            description: tToast('folder.deleteSuccessDescription', `Deleted ${result.deletedFolders} folder(s) and ${result.deletedDocuments} file(s).`, { folders: result.deletedFolders, files: result.deletedDocuments }),
          });
        } catch (err) {
          const fallback = tError('deleteFolder', 'Failed to delete folder');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message, isDeleting: false });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      getFolderContents: async (workspaceId, folderId, params) => {
        set({ isLoadingDocuments: true, error: null });

        try {
          const result = await workspaceApi.getFolderContents(workspaceId, folderId, params);
          const newCache = new Map();
          newCache.set(1, result.documents);
          set({
            documents: newCache,
            documentsCurrentPage: 1,
            documentsTotalPages: result.pagination.totalPages,
            totalDocuments: result.pagination.total,
            isLoadingDocuments: false,
          });
        } catch (err) {
          const fallback = tError('fetchFolderContents', 'Failed to fetch folder contents');
          const message = err instanceof Error ? err.message : fallback;
          set({ error: message, isLoadingDocuments: false });
        }
      },

      moveDocuments: async (workspaceId, documentIds, targetFolderId) => {
        try {
          const result = await workspaceApi.moveDocuments(workspaceId, documentIds, targetFolderId);
          if (result.failed.length > 0) {
            toast.warning(tToast('documents.movePartialTitle', 'Moved {{count}} documents', { count: result.moved }), {
              description: tToast('documents.movePartialDescription', '{{count}} documents failed to move.', { count: result.failed.length }),
            });
          } else {
            toast.success(tToast('documents.moveSuccessTitle', 'Moved {{count}} documents', { count: result.moved }));
          }

          // Invalidate cache and refresh
          get().invalidateDocumentCache();
          const currentFolderId = get().currentFolderId;
          await get().fetchDocuments(workspaceId, 1);
          await get().fetchAllFolders(workspaceId);
          await get().refreshWorkspace(workspaceId);

          return result;
        } catch (err) {
          const fallback = tError('moveDocuments', 'Failed to move documents');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message });
          toast.error(fallback, { description: message });
          throw err;
        }
      },

      getPersonalWorkspace: async () => {
        const state = get();

        // Check if personal workspace is already in cache
        const personalWorkspace = state.workspaces.get(1)?.find((w) => w.isPersonal);

        if (personalWorkspace) {
          return personalWorkspace;
        }

        try {
          const workspace = await workspaceApi.getPersonalWorkspace();
          // Add to cache at page 1
          const normalizedWorkspace = {
            ...workspace,
            documentCount: Math.max(0, get().totalDocuments || workspace.documentCount),
          };
          const newCache = new Map(state.workspaces);
          const page1Workspaces = state.workspaces.get(1) || [];
          newCache.set(1, [normalizedWorkspace, ...page1Workspaces]);

          set({
            workspaces: newCache,
            totalWorkspaces: state.totalWorkspaces + 1,
          });
        } catch (err) {
          const fallback = tError('fetchWorkspaces', 'Failed to fetch personal workspace');
          const message = err instanceof Error ? err.message : fallback;
          set({ error: message });
        }
      },
    }),
    { name: 'workspace-store' },
  ),
);

// ===== Selector Hooks for Performance =====

export const useWorkspaces = () => {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const currentPage = useWorkspaceStore((state) => state.currentPage) ?? 1;
  return workspaces?.get(currentPage) || [];
};

export const useDocumentPagination = () => {
  const currentPage = useWorkspaceStore((state) => state.documentsCurrentPage) ?? 1;
  const totalPages = useWorkspaceStore((state) => state.documentsTotalPages) ?? 1;
  const totalDocuments = useWorkspaceStore((state) => state.totalDocuments) ?? 0;
  return { currentPage, totalPages, totalDocuments };
};

export const useUploadQueue = () => {
  const queue = useWorkspaceStore((state) => state.uploadQueue);
  return queue ?? [];
};

export const useUploadState = () => {
  return useWorkspaceStore(
    useShallow((state) => ({
      uploadQueue: state.uploadQueue,
      isUploading: state.isUploading,
      uploadSessionId: state.uploadSessionId,
    })),
  );
};

export const useHasActiveUploads = () => {
  const queue = useWorkspaceStore((state) => state.uploadQueue);
  return queue?.some((item) => item.status === 'pending' || item.status === 'uploading') ?? false;
};

export const useWorkspaceModalState = () =>
  useWorkspaceStore(
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

export const useWorkspaceLoading = () => {
  return useWorkspaceStore(
    useShallow((state) => ({
      isLoadingWorkspaces: state.isLoadingWorkspaces,
      isLoadingDocuments: state.isLoadingDocuments,
      isLoadingTemplates: state.isLoadingTemplates,
      isLoadingSettings: state.isLoadingSettings,
      isCreating: state.isCreating,
      isDeleting: state.isDeleting,
    })),
  );
};

export const useCurrentWorkspaceSettings = () => {
  return useWorkspaceStore((state) => state.currentWorkspaceSettings);
};

export const useSettingsTargetWorkspace = () => {
  return useWorkspaceStore((state) => state.settingsTargetWorkspace);
};

export const useSelectedWorkspace = () => {
  return useWorkspaceStore((state) => state.selectedWorkspace) ?? null;
};

export const useDocuments = () => {
  const documentsMap = useWorkspaceStore((state) => state.documents) ?? new Map();
  const currentPage = useWorkspaceStore((state) => state.documentsCurrentPage) ?? 1;
  const totalPages = useWorkspaceStore((state) => state.documentsTotalPages) ?? 1;
  // Get documents for current page
  const documents = documentsMap.get(currentPage) ?? [];
  return { documents, currentPage, totalPages };
};

// Hook to get all documents as a flat array for tree view
export const useAllDocuments = () => {
  const documentsMap = useWorkspaceStore((state) => state.documents) ?? new Map();
  const currentPage = useWorkspaceStore((state) => state.documentsCurrentPage) ?? 1;
  // Flatten all documents from the Map into a single array
  const allDocuments = Array.from(documentsMap.values()).flat();
  return { documents: allDocuments, currentPage };
};

// Hook to get all folders for sidebar tree view
export const useAllFolders = () => {
  return useWorkspaceStore((state) => state.allFolders) ?? [];
};

export const useWorkspacePagination = () => {
  const currentPage = useWorkspaceStore((state) => state.currentPage) ?? 1;
  const totalPages = useWorkspaceStore((state) => state.totalPages) ?? 1;
  return { currentPage, totalPages };
};
