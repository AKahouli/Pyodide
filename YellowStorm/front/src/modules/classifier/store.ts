import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type {
  ClassificationRun,
  ClassifierFile,
  ClassifierFolder,
  ClassifierWorkspace,
} from './types';

const STORAGE_KEY = 'classifier:state:v1';

const MOCK_WORKSPACES: ClassifierWorkspace[] = [
  { id: 'ws-legal', name: 'Legal & Compliance' },
  { id: 'ws-hr', name: 'Human Resources' },
  { id: 'ws-finance', name: 'Finance' },
  { id: 'ws-rnd', name: 'R&D Knowledge Base' },
];

const MOCK_FOLDERS: ClassifierFolder[] = [
  {
    id: 'f-1',
    workspaceId: 'ws-legal',
    parentId: null,
    name: 'Contrats',
    description: 'Tous les contrats signés avec partenaires et clients.',
    createdAt: '2026-04-10T10:00:00Z',
    updatedAt: '2026-05-01T10:00:00Z',
  },
  {
    id: 'f-2',
    workspaceId: 'ws-legal',
    parentId: null,
    name: 'Conformité RGPD',
    description: 'Documents liés à la conformité données personnelles.',
    createdAt: '2026-04-12T10:00:00Z',
    updatedAt: '2026-05-01T10:00:00Z',
  },
  {
    id: 'f-3',
    workspaceId: 'ws-legal',
    parentId: 'f-1',
    name: 'Clients Entreprise',
    description: 'Contrats grands comptes – plus de 500 employés.',
    createdAt: '2026-04-15T10:00:00Z',
    updatedAt: '2026-05-01T10:00:00Z',
  },
];

const MOCK_FILES: ClassifierFile[] = [
  {
    id: 'file-1',
    workspaceId: 'ws-legal',
    name: 'Contrat-ACME-2026.pdf',
    mimeType: 'application/pdf',
    size: 482_034,
    uploadedAt: '2026-05-10T10:00:00Z',
    folderId: 'f-1',
  },
  {
    id: 'file-2',
    workspaceId: 'ws-legal',
    name: 'Politique-confidentialite.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 128_900,
    uploadedAt: '2026-05-11T10:00:00Z',
    folderId: 'f-2',
  },
  {
    id: 'file-3',
    workspaceId: 'ws-legal',
    name: 'Notes-meeting-legal.md',
    mimeType: 'text/markdown',
    size: 8_402,
    uploadedAt: '2026-05-15T10:00:00Z',
    folderId: null,
  },
];

interface ClassifierState {
  workspaces: ClassifierWorkspace[];
  folders: ClassifierFolder[];
  files: ClassifierFile[];
  selectedWorkspaceId: string | null;
  currentFolderId: string | null;
  search: string;
  lastRun: ClassificationRun | null;

  selectWorkspace: (id: string | null) => void;
  navigateToFolder: (id: string | null) => void;
  setSearch: (value: string) => void;

  createFolder: (input: { name: string; description: string; parentId: string | null }) => void;
  updateFolder: (id: string, input: { name: string; description: string }) => void;
  deleteFolder: (id: string) => void;
  moveFolder: (id: string, newParentId: string | null) => void;

  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  setFileFolder: (fileId: string, folderId: string | null) => void;

  runClassification: (playbook: string) => Promise<void>;
  resetMockData: () => void;
}

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useClassifierStore = create<ClassifierState>()(
  devtools(
    persist(
      (set, get) => ({
        workspaces: MOCK_WORKSPACES,
        folders: MOCK_FOLDERS,
        files: MOCK_FILES,
        selectedWorkspaceId: null,
        currentFolderId: null,
        search: '',
        lastRun: null,

        selectWorkspace: (id) =>
          set({ selectedWorkspaceId: id, currentFolderId: null, search: '' }),
        navigateToFolder: (folderId) => set({ currentFolderId: folderId }),
        setSearch: (value) => set({ search: value }),

        createFolder: ({ name, description, parentId }) => {
          const workspaceId = get().selectedWorkspaceId;
          if (!workspaceId) return;
          const now = new Date().toISOString();
          const folder: ClassifierFolder = {
            id: id('f'),
            workspaceId,
            parentId,
            name: name.trim(),
            description: description.trim(),
            createdAt: now,
            updatedAt: now,
          };
          set((s) => ({ folders: [folder, ...s.folders] }));
        },

        updateFolder: (folderId, input) => {
          set((s) => ({
            folders: s.folders.map((f) =>
              f.id === folderId
                ? {
                    ...f,
                    name: input.name.trim(),
                    description: input.description.trim(),
                    updatedAt: new Date().toISOString(),
                  }
                : f,
            ),
          }));
        },

        deleteFolder: (folderId) => {
          const collectDescendants = (rootId: string, all: ClassifierFolder[]): string[] => {
            const direct = all.filter((f) => f.parentId === rootId).map((f) => f.id);
            return direct.concat(direct.flatMap((c) => collectDescendants(c, all)));
          };
          set((s) => {
            const toRemove = new Set<string>([folderId, ...collectDescendants(folderId, s.folders)]);
            return {
              folders: s.folders.filter((f) => !toRemove.has(f.id)),
              files: s.files.map((file) =>
                file.folderId && toRemove.has(file.folderId) ? { ...file, folderId: null } : file,
              ),
              currentFolderId: toRemove.has(s.currentFolderId ?? '') ? null : s.currentFolderId,
            };
          });
        },

        moveFolder: (folderId, newParentId) => {
          if (folderId === newParentId) return;
          set((s) => {
            const isDescendant = (candidate: string | null): boolean => {
              if (!candidate) return false;
              if (candidate === folderId) return true;
              const parent = s.folders.find((f) => f.id === candidate);
              return parent ? isDescendant(parent.parentId) : false;
            };
            if (isDescendant(newParentId)) return s;
            return {
              folders: s.folders.map((f) =>
                f.id === folderId ? { ...f, parentId: newParentId, updatedAt: new Date().toISOString() } : f,
              ),
            };
          });
        },

        addFiles: (files) => {
          const workspaceId = get().selectedWorkspaceId;
          if (!workspaceId) return;
          const currentFolderId = get().currentFolderId;
          const newFiles: ClassifierFile[] = files.map((file) => ({
            id: id('file'),
            workspaceId,
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            uploadedAt: new Date().toISOString(),
            folderId: currentFolderId ?? null,
          }));
          set((s) => ({ files: [...newFiles, ...s.files] }));
        },

        removeFile: (fileId) => {
          set((s) => ({ files: s.files.filter((f) => f.id !== fileId) }));
        },

        setFileFolder: (fileId, folderId) => {
          set((s) => ({
            files: s.files.map((f) => (f.id === fileId ? { ...f, folderId } : f)),
          }));
        },

        runClassification: async (playbook) => {
          const workspaceId = get().selectedWorkspaceId;
          if (!workspaceId) return;
          const run: ClassificationRun = {
            id: id('run'),
            workspaceId,
            status: 'running',
            startedAt: new Date().toISOString(),
            playbook,
            totalFiles: get().files.filter((f) => f.workspaceId === workspaceId).length,
            classifiedFiles: 0,
          };
          set({ lastRun: run });
          await new Promise((res) => setTimeout(res, 1800));
          const workspaceFolders = get().folders.filter((f) => f.workspaceId === workspaceId);
          set((s) => ({
            files: s.files.map((file) => {
              if (file.workspaceId !== workspaceId || file.folderId) return file;
              if (workspaceFolders.length === 0) return file;
              const pick = workspaceFolders[Math.floor(Math.random() * workspaceFolders.length)];
              return { ...file, folderId: pick.id };
            }),
            lastRun: {
              ...run,
              status: 'success',
              finishedAt: new Date().toISOString(),
              classifiedFiles: run.totalFiles,
            },
          }));
        },

        resetMockData: () =>
          set({
            workspaces: MOCK_WORKSPACES,
            folders: MOCK_FOLDERS,
            files: MOCK_FILES,
            selectedWorkspaceId: null,
            currentFolderId: null,
            search: '',
            lastRun: null,
          }),
      }),
      {
        name: STORAGE_KEY,
        partialize: (state) => ({
          folders: state.folders,
          files: state.files,
        }),
      },
    ),
    { name: 'classifier-store' },
  ),
);

export const useClassifierWorkspaces = () => useClassifierStore((s) => s.workspaces);
export const useSelectedWorkspace = () => {
  const id = useClassifierStore((s) => s.selectedWorkspaceId);
  const list = useClassifierStore((s) => s.workspaces);
  return id ? list.find((w) => w.id === id) ?? null : null;
};
