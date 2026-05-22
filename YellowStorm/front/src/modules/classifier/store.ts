import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/error-codes';
import type { ApiError } from '@/lib/api/client';
import { useWorkspaceStore } from '@/modules/workspace';
import { validateFiles } from '@/modules/workspace/utils';
import * as api from './api';
import type {
  ClassificationRun,
  ClassifierFile,
  ClassifierFolder,
  CreateFolderInput,
  UpdateFolderInput,
} from './types';

function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return getErrorMessage((err as ApiError).code);
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

interface ClassifierState {
  selectedWorkspaceId: string | null;
  currentFolderId: string | null;
  search: string;

  folders: ClassifierFolder[];
  files: ClassifierFile[];

  loadingFolders: boolean;
  loadingFiles: boolean;
  workspaceLoadedFor: string | null;

  lastRun: ClassificationRun | null;
  runningClassification: boolean;

  selectWorkspace: (id: string | null) => Promise<void>;
  navigateToFolder: (id: string | null) => void;
  setSearch: (value: string) => void;
  refreshWorkspace: () => Promise<void>;

  createFolder: (input: CreateFolderInput) => Promise<ClassifierFolder | null>;
  updateFolder: (id: string, input: UpdateFolderInput) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFolder: (id: string, newParentId: string | null) => Promise<void>;

  setFileFolder: (fileId: string, folderId: string | null) => Promise<void>;
  uploadFiles: (files: File[]) => Promise<void>;

  runClassification: (input: { playbookId: string; hint?: string; overwrite?: boolean }) => Promise<void>;
  pollRun: (runId: string) => Promise<void>;
}

export const useClassifierStore = create<ClassifierState>()(
  devtools(
    (set, get) => ({
      selectedWorkspaceId: null,
      currentFolderId: null,
      search: '',
      folders: [],
      files: [],
      loadingFolders: false,
      loadingFiles: false,
      workspaceLoadedFor: null,
      lastRun: null,
      runningClassification: false,

      selectWorkspace: async (id) => {
        const previous = get().selectedWorkspaceId;
        set({
          selectedWorkspaceId: id,
          currentFolderId: null,
          search: '',
          // Drop stale data immediately on workspace switch.
          folders: id !== previous ? [] : get().folders,
          files: id !== previous ? [] : get().files,
          workspaceLoadedFor: id !== previous ? null : get().workspaceLoadedFor,
          lastRun: null,
        });
        if (id) {
          await get().refreshWorkspace();
        }
      },

      navigateToFolder: (folderId) => set({ currentFolderId: folderId }),
      setSearch: (value) => set({ search: value }),

      refreshWorkspace: async () => {
        const workspaceId = get().selectedWorkspaceId;
        if (!workspaceId) return;
        set({ loadingFolders: true, loadingFiles: true });
        try {
          const [folders, files] = await Promise.all([
            api.listFolders(workspaceId),
            api.listFiles(workspaceId),
          ]);
          set({
            folders,
            files,
            workspaceLoadedFor: workspaceId,
            loadingFolders: false,
            loadingFiles: false,
          });
        } catch (err) {
          set({ loadingFolders: false, loadingFiles: false });
          toast.error(describeError(err, 'Impossible de charger le workspace'));
        }
      },

      createFolder: async (input) => {
        const workspaceId = get().selectedWorkspaceId;
        if (!workspaceId) return null;
        try {
          const folder = await api.createFolder(workspaceId, input);
          set((s) => ({ folders: [folder, ...s.folders] }));
          return folder;
        } catch (err) {
          toast.error(describeError(err, 'Échec de la création du dossier'));
          return null;
        }
      },

      updateFolder: async (folderId, input) => {
        try {
          const updated = await api.updateFolder(folderId, input);
          set((s) => ({
            folders: s.folders.map((f) => (f.id === folderId ? updated : f)),
          }));
        } catch (err) {
          toast.error(describeError(err, 'Échec de la mise à jour du dossier'));
        }
      },

      deleteFolder: async (folderId) => {
        try {
          await api.deleteFolder(folderId);
          // Refresh to capture cascaded deletions and re-cleared assignments.
          await get().refreshWorkspace();
          if (get().currentFolderId === folderId) {
            set({ currentFolderId: null });
          }
        } catch (err) {
          toast.error(describeError(err, 'Échec de la suppression du dossier'));
        }
      },

      moveFolder: async (folderId, newParentId) => {
        const previous = get().folders;
        // Optimistic: update parentId locally, revert on failure.
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === folderId ? { ...f, parentId: newParentId } : f,
          ),
        }));
        try {
          const updated = await api.moveFolder(folderId, newParentId);
          set((s) => ({
            folders: s.folders.map((f) => (f.id === folderId ? updated : f)),
          }));
        } catch (err) {
          set({ folders: previous });
          toast.error(describeError(err, 'Échec du déplacement du dossier'));
        }
      },

      uploadFiles: async (files) => {
        const workspaceId = get().selectedWorkspaceId;
        if (!workspaceId || files.length === 0) return;

        const { validFiles } = validateFiles(files);
        if (validFiles.length === 0) return;

        const wsStore = useWorkspaceStore.getState();
        wsStore.addFilesToQueue(validFiles, workspaceId);
        try {
          await wsStore.startUpload();
          toast.success(
            validFiles.length === 1
              ? 'Fichier ajouté'
              : `${validFiles.length} fichiers ajoutés`,
          );
          await get().refreshWorkspace();
        } catch (err) {
          toast.error(describeError(err, "Échec de l'upload"));
        }
      },

      setFileFolder: async (fileId, folderId) => {
        const workspaceId = get().selectedWorkspaceId;
        if (!workspaceId) return;
        const previous = get().files;
        set((s) => ({
          files: s.files.map((f) => (f.id === fileId ? { ...f, folderId } : f)),
        }));
        try {
          const updated = await api.assignFileToFolder(workspaceId, fileId, folderId);
          set((s) => ({
            files: s.files.map((f) => (f.id === fileId ? updated : f)),
          }));
        } catch (err) {
          set({ files: previous });
          toast.error(describeError(err, 'Échec du déplacement du fichier'));
        }
      },

      runClassification: async ({ playbookId, hint, overwrite }) => {
        const workspaceId = get().selectedWorkspaceId;
        if (!workspaceId) return;
        set({ runningClassification: true });
        try {
          const run = await api.startRun(workspaceId, { playbookId, hint, overwrite });
          set({ lastRun: run, runningClassification: false });
          // Refresh files since the backend may apply assignments as the run progresses.
          await get().refreshWorkspace();
        } catch (err) {
          set({ runningClassification: false });
          toast.error(describeError(err, 'Échec du lancement de la classification'));
        }
      },

      pollRun: async (runId) => {
        try {
          const run = await api.getRun(runId);
          set({ lastRun: run });
        } catch (err) {
          toast.error(describeError(err, 'Échec de la récupération du run'));
        }
      },
    }),
    { name: 'classifier-store' },
  ),
);
