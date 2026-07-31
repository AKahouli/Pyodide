/**
 * Worky UI-only state (drawer open, selected task, panel sizes). Kept
 * separate from `store.ts` so ephemeral UI state doesn't dirty the
 * server-state cache.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type WorkyMobileTab = 'agents' | 'chat' | 'more';
export type WorkyMobileSheet = 'agent' | 'task' | 'budget' | 'approval' | 'chat';

interface WorkyUiState {
  isTaskDrawerOpen: boolean;
  selectedTaskId: string | null;
  sidebarCollapsed: boolean;
  orchestratorOpen: boolean;
  sendError: string | null;
  /** Active bottom tab in the mobile layout. */
  mobileTab: WorkyMobileTab;
  /** Which bottom sheet is open in the mobile layout (null = none). */
  activeSheet: WorkyMobileSheet | null;
  /** Whether the live voice session overlay is open. */
  voiceOpen: boolean;
  setTaskDrawerOpen: (open: boolean) => void;
  setSelectedTaskId: (id: string | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setOrchestratorOpen: (open: boolean) => void;
  setMobileTab: (tab: WorkyMobileTab) => void;
  setActiveSheet: (sheet: WorkyMobileSheet | null) => void;
  setVoiceOpen: (open: boolean) => void;
  notifySendError: (message: string) => void;
  clearSendError: () => void;
  reset: () => void;
}

const initialState = {
  isTaskDrawerOpen: false,
  selectedTaskId: null as string | null,
  sidebarCollapsed: false,
  orchestratorOpen: false,
  sendError: null as string | null,
  mobileTab: 'agents' as WorkyMobileTab,
  activeSheet: null as WorkyMobileSheet | null,
  voiceOpen: false,
};

export const useWorkyUiStore = create<WorkyUiState>()(
  devtools(
    (set) => ({
      ...initialState,
      setTaskDrawerOpen: (isTaskDrawerOpen) => set({ isTaskDrawerOpen }),
      setSelectedTaskId: (selectedTaskId) =>
        set({ selectedTaskId, isTaskDrawerOpen: selectedTaskId != null }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setOrchestratorOpen: (orchestratorOpen) => set({ orchestratorOpen }),
      setMobileTab: (mobileTab) => set({ mobileTab }),
      setActiveSheet: (activeSheet) => set({ activeSheet }),
      setVoiceOpen: (voiceOpen) => set({ voiceOpen }),
      notifySendError: (sendError) => set({ sendError }),
      clearSendError: () => set({ sendError: null }),
      reset: () => set(initialState),
    }),
    { name: 'worky-ui-store' },
  ),
);
