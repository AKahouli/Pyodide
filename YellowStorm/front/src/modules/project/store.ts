import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/api-error';
import { i18nInstance } from '@/modules/localization/i18nInstance';
import * as api from './api';
import type { Project, SharedProjectResponse } from './types';
import { useConversationStore } from '@/modules/conversation/store';

function tProject(key: string, fallback: string, options?: Record<string, unknown>) {
  if (i18nInstance.isInitialized) {
    return i18nInstance.t(key, { ns: 'sidebar', defaultValue: fallback, ...options });
  }
  return fallback;
}

interface ProjectState {
  projects: Project[];
  sharedProjects: SharedProjectResponse[];
  loading: boolean;
  initialized: boolean;
  expandedProjectIds: Record<string, boolean>;

  fetchProjects: (search?: string) => Promise<void>;
  fetchSharedProjects: () => Promise<void>;
  createProject: (name: string) => Promise<Project>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setExpanded: (id: string, open: boolean) => void;
  toggleExpanded: (id: string) => void;
  decrementCount: (id: string) => void;
  incrementCount: (id: string) => void;
}

export const useProjectStore = create<ProjectState>()(
  devtools(
    (set, get) => ({
      projects: [],
      sharedProjects: [],
      loading: false,
      initialized: false,
      expandedProjectIds: typeof window !== 'undefined'
        ? safeParse(localStorage.getItem('projects:expanded')) ?? {}
        : {},

      fetchProjects: async (search?: string) => {
        set({ loading: true });
        try {
          const projects = await api.listProjects(search);
          set({ projects, loading: false, initialized: true });
        } catch (err) {
          set({ loading: false });
          console.error('[ProjectStore] fetchProjects error:', err);
        }
      },

      fetchSharedProjects: async () => {
        try {
          const result = await api.getSharedProjects();
          set({ sharedProjects: result.projects });
        } catch (err) {
          console.error('[ProjectStore] fetchSharedProjects error:', err);
        }
      },

      createProject: async (name: string) => {
        try {
          const project = await api.createProject({ name });
          set((s) => ({ projects: [project, ...s.projects] }));
          toast.success(tProject('projects.toasts.created', 'Project created'));
          return project;
        } catch (err) {
          const e = parseApiError(err);
          toast.error(tProject('projects.toasts.createError', 'Could not create project'), {
            description: e.message,
          });
          throw err;
        }
      },

      renameProject: async (id, name) => {
        const previous = get().projects;
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)),
        }));
        try {
          const updated = await api.updateProject(id, { name });
          set((s) => ({
            projects: s.projects.map((p) => (p.id === id ? updated : p)),
          }));
        } catch (err) {
          set({ projects: previous });
          const e = parseApiError(err);
          toast.error(tProject('projects.toasts.renameError', 'Could not rename project'), {
            description: e.message,
          });
          throw err;
        }
      },

      deleteProject: async (id) => {
        const previous = get().projects;
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
        try {
          await api.deleteProject(id);
          useConversationStore.getState().detachConversationsFromProject(id);
          toast.success(tProject('projects.toasts.deleted', 'Project deleted'));
        } catch (err) {
          set({ projects: previous });
          const e = parseApiError(err);
          toast.error(tProject('projects.toasts.deleteError', 'Could not delete project'), {
            description: e.message,
          });
          throw err;
        }
      },

      setExpanded: (id, open) => {
        set((s) => {
          const next = { ...s.expandedProjectIds, [id]: open };
          if (typeof window !== 'undefined') {
            localStorage.setItem('projects:expanded', JSON.stringify(next));
          }
          return { expandedProjectIds: next };
        });
      },

      toggleExpanded: (id) => {
        const current = !!get().expandedProjectIds[id];
        get().setExpanded(id, !current);
      },

      decrementCount: (id) => {
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, conversationCount: Math.max(0, p.conversationCount - 1) } : p,
          ),
        }));
      },

      incrementCount: (id) => {
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, conversationCount: p.conversationCount + 1 } : p,
          ),
        }));
      },
    }),
    { name: 'project-store' },
  ),
);

function safeParse(input: string | null): Record<string, boolean> | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, boolean>) : null;
  } catch {
    return null;
  }
}

export const useProjects = () => useProjectStore(useShallow((s) => s.projects));
export const useSharedProjects = () => useProjectStore(useShallow((s) => s.sharedProjects));
export const useProjectsLoading = () => useProjectStore((s) => s.loading);
export const useExpandedProjectIds = () =>
  useProjectStore(useShallow((s) => s.expandedProjectIds));
