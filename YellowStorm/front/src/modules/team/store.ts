/**
 * Team Store
 * Zustand store for user teams management. Mirrors the agent store conventions
 * (5-minute freshness cache, optimistic list updates, selector hooks).
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import type { TeamStore, TeamState } from './types';
import * as api from './api';
import { translateTeam } from './translation';

const initialState: TeamState = {
  teams: [],
  currentTeam: null,
  currentTeamLoading: false,
  isGenerating: false,
  isLoading: false,
  isInitialized: false,
  error: null,
  lastFetchedAt: null,
};

export const useTeamStore = create<TeamStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      fetchTeams: async () => {
        const state = get();
        if (state.isLoading) return;

        // Skip if fresh (< 5 minutes)
        if (
          state.isInitialized &&
          state.lastFetchedAt &&
          Date.now() - state.lastFetchedAt.getTime() < 5 * 60 * 1000
        ) {
          return;
        }

        set({ isLoading: true, error: null });
        try {
          const teams = await api.getAllTeams();
          set({ teams, isLoading: false, isInitialized: true, error: null, lastFetchedAt: new Date() });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : translateTeam('store.errors.fetchTeamsFailed');
          set({ isLoading: false, error: errorMessage });
          throw err;
        }
      },

      refreshTeams: async () => {
        set({ lastFetchedAt: null, isInitialized: false });
        await get().fetchTeams();
      },

      fetchTeamById: async (id) => {
        set({ currentTeamLoading: true, error: null });
        try {
          const team = await api.getTeamById(id);
          set({ currentTeam: team, currentTeamLoading: false });
          return team;
        } catch (err) {
          set({ currentTeamLoading: false });
          throw err;
        }
      },

      updateHierarchy: async (id, data) => {
        const team = await api.updateHierarchy(id, data);
        set((state) => ({
          currentTeam: team,
          teams: state.teams.map((t) => (t.id === id ? { ...t, agentCount: team.agentCount } : t)),
        }));
        return team;
      },

      setCurrentTeam: (team) => set({ currentTeam: team }),

      generateTeam: async (data) => {
        set({ isGenerating: true, currentTeam: null, error: null });
        try {
          const team = await api.generateTeam(data);
          set((state) => ({
            isGenerating: false,
            currentTeam: team,
            teams: [{ ...team, members: team.members }, ...state.teams],
          }));
          toast.success(translateTeam('store.toasts.teamGenerated'), {
            description: translateTeam('store.toasts.teamGeneratedDescription', { name: team.name }),
          });
          return team;
        } catch (err) {
          set({ isGenerating: false });
          throw err;
        }
      },

      unshareTeam: async (id) => {
        await api.unshareTeam(id);
        set((state) => ({ teams: state.teams.filter((t) => t.id !== id) }));
        toast.success(translateTeam('store.toasts.teamUnshared'), {
          description: translateTeam('store.toasts.teamUnsharedDescription'),
        });
      },

      createTeam: async (data) => {
        const team = await api.createTeam(data);
        set((state) => ({ teams: [team, ...state.teams] }));
        toast.success(translateTeam('store.toasts.teamCreated'), {
          description: translateTeam('store.toasts.teamCreatedDescription', { name: team.name }),
        });
        return team;
      },

      updateTeam: async (id, data) => {
        const team = await api.updateTeam(id, data);
        set((state) => ({ teams: state.teams.map((t) => (t.id === id ? team : t)) }));
        toast.success(translateTeam('store.toasts.teamUpdated'), {
          description: translateTeam('store.toasts.teamUpdatedDescription', { name: team.name }),
        });
        return team;
      },

      deleteTeam: async (id) => {
        const team = get().teams.find((t) => t.id === id);
        await api.deleteTeam(id);
        set((state) => ({ teams: state.teams.filter((t) => t.id !== id) }));
        toast.success(translateTeam('store.toasts.teamDeleted'), {
          description: translateTeam('store.toasts.teamDeletedDescription', {
            name: team?.name || translateTeam('store.defaults.teamName'),
          }),
        });
      },

      getTeamById: (id) => get().teams.find((t) => t.id === id),

      reset: () => set(initialState),
    }),
    { name: 'team-store' },
  ),
);

// ===== Selector Hooks =====

export const useTeams = () => useTeamStore(useShallow((state) => state.teams));
export const usePersonalTeams = () =>
  useTeamStore(useShallow((state) => state.teams.filter((t) => !t.shareInfo)));
export const useSharedTeams = () =>
  useTeamStore(useShallow((state) => state.teams.filter((t) => t.shareInfo)));
export const useCurrentTeam = () => useTeamStore((state) => state.currentTeam);
export const useCurrentTeamLoading = () => useTeamStore((state) => state.currentTeamLoading);
export const useIsGenerating = () => useTeamStore((state) => state.isGenerating);
export const useTeamsLoading = () => useTeamStore((state) => state.isLoading);
export const useTeamsInitialized = () => useTeamStore((state) => state.isInitialized);
export const useTeamsError = () => useTeamStore((state) => state.error);
export const useTeamById = (id: string) =>
  useTeamStore(useShallow((state) => state.teams.find((t) => t.id === id)));
