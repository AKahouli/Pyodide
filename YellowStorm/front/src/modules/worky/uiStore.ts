/**
 * Worky UI-only state (drawer open, selected task, panel sizes). Kept
 * separate from `store.ts` so ephemeral UI state doesn't dirty the
 * server-state cache.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type WorkyMobileSheet = 'task' | 'approval' | 'chat';

/** A single live activity-feed entry (accumulated in-session from SSE events). */
export interface WorkyActivityItem {
  key: string;
  icon: string;
  tone: 'working' | 'blocked' | 'done' | 'primary' | 'muted';
  text: string;
}

interface WorkyUiState {
  isTaskDrawerOpen: boolean;
  selectedTaskId: string | null;
  orchestratorOpen: boolean;
  sendError: string | null;
  /** Which bottom sheet is open in the mobile layout (null = none). */
  activeSheet: WorkyMobileSheet | null;
  /** Whether the live voice session overlay is open. */
  voiceOpen: boolean;
  /** Live activity feed, newest first, bounded to the last 20 events. */
  recentActivity: WorkyActivityItem[];
  setTaskDrawerOpen: (open: boolean) => void;
  setSelectedTaskId: (id: string | null) => void;
  setOrchestratorOpen: (open: boolean) => void;
  setActiveSheet: (sheet: WorkyMobileSheet | null) => void;
  setVoiceOpen: (open: boolean) => void;
  pushActivity: (item: WorkyActivityItem) => void;
  clearActivity: () => void;
  notifySendError: (message: string) => void;
  clearSendError: () => void;
  reset: () => void;
}

const initialState = {
  isTaskDrawerOpen: false,
  selectedTaskId: null as string | null,
  orchestratorOpen: false,
  sendError: null as string | null,
  activeSheet: null as WorkyMobileSheet | null,
  voiceOpen: false,
  recentActivity: [] as WorkyActivityItem[],
};

export const useWorkyUiStore = create<WorkyUiState>()(
  devtools(
    (set) => ({
      ...initialState,
      setTaskDrawerOpen: (isTaskDrawerOpen) => set({ isTaskDrawerOpen }),
      setSelectedTaskId: (selectedTaskId) =>
        set({ selectedTaskId, isTaskDrawerOpen: selectedTaskId != null }),
      setOrchestratorOpen: (orchestratorOpen) => set({ orchestratorOpen }),
      setActiveSheet: (activeSheet) => set({ activeSheet }),
      setVoiceOpen: (voiceOpen) => set({ voiceOpen }),
      pushActivity: (item) =>
        set((s) => ({ recentActivity: [item, ...s.recentActivity].slice(0, 20) })),
      clearActivity: () => set({ recentActivity: [] }),
      notifySendError: (sendError) => set({ sendError }),
      clearSendError: () => set({ sendError: null }),
      reset: () => set(initialState),
    }),
    { name: 'worky-ui-store' },
  ),
);
