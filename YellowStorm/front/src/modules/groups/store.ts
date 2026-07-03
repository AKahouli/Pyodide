/**
 * Groups Store
 * Zustand store for user-group management. Mirrors the team store conventions
 * (optimistic list updates, toast on mutations, selector hooks).
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import type { GroupsStore, GroupsState } from './types';
import * as api from './api';
import { translateGroup } from './translation';

const initialState: GroupsState = {
  groups: [],
  isLoading: false,
  isInitialized: false,
  error: null,
};

export const useGroupsStore = create<GroupsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      fetchGroups: async () => {
        if (get().isLoading) return;
        set({ isLoading: true, error: null });
        try {
          const groups = await api.getGroups();
          set({ groups, isLoading: false, isInitialized: true, error: null });
        } catch (err) {
          const message = err instanceof Error ? err.message : translateGroup('store.errors.fetchFailed');
          set({ isLoading: false, error: message });
          throw err;
        }
      },

      createGroup: async (data) => {
        const group = await api.createGroup(data);
        set((state) => ({ groups: [group, ...state.groups] }));
        toast.success(translateGroup('store.toasts.created', { name: group.name }));
        return group;
      },

      updateGroup: async (id, data) => {
        const group = await api.updateGroup(id, data);
        set((state) => ({ groups: state.groups.map((g) => (g.id === id ? group : g)) }));
        toast.success(translateGroup('store.toasts.updated', { name: group.name }));
        return group;
      },

      deleteGroup: async (id) => {
        const group = get().groups.find((g) => g.id === id);
        await api.deleteGroup(id);
        set((state) => ({ groups: state.groups.filter((g) => g.id !== id) }));
        toast.success(translateGroup('store.toasts.deleted', { name: group?.name ?? '' }));
      },

      addMembers: async (id, userIds) => {
        const group = await api.addMembers(id, userIds);
        set((state) => ({ groups: state.groups.map((g) => (g.id === id ? group : g)) }));
        return group;
      },

      removeMember: async (id, userId) => {
        const group = await api.removeMember(id, userId);
        set((state) => ({ groups: state.groups.map((g) => (g.id === id ? group : g)) }));
        return group;
      },

      reset: () => set(initialState),
    }),
    { name: 'groups-store' },
  ),
);

// ===== Selector Hooks =====
export const useGroups = () => useGroupsStore(useShallow((state) => state.groups));
export const useGroupsLoading = () => useGroupsStore((state) => state.isLoading);
export const useGroupsInitialized = () => useGroupsStore((state) => state.isInitialized);
