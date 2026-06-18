/**
 * Worky UI-only state (drawer open, selected task, panel sizes). Kept
 * separate from `store.ts` so ephemeral UI state doesn't dirty the
 * server-state cache.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface WorkyUiState {
  isTaskDrawerOpen: boolean;
  selectedTaskId: string | null;
  sidebarCollapsed: boolean;
  setTaskDrawerOpen: (open: boolean) => void;
  setSelectedTaskId: (id: string | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  reset: () => void;
}

const initialState = {
  isTaskDrawerOpen: false,
  selectedTaskId: null as string | null,
  sidebarCollapsed: false,
};

export const useWorkyUiStore = create<WorkyUiState>()(
  devtools(
    (set) => ({
      ...initialState,
      setTaskDrawerOpen: (isTaskDrawerOpen) => set({ isTaskDrawerOpen }),
      setSelectedTaskId: (selectedTaskId) =>
        set({ selectedTaskId, isTaskDrawerOpen: selectedTaskId != null }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      reset: () => set(initialState),
    }),
    { name: 'worky-ui-store' },
  ),
);
