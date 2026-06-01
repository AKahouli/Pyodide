import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type { PlaybookCopilotMode, PlaybookPageMode } from './types';

const EXEC_PANEL_KEY = 'ys_playbook_exec_panel';
const WORKSPACE_EXPLORER_KEY = 'ys_workspace_explorer_open';

function readBooleanPreference(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeBooleanPreference(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Browser storage can be unavailable in private mode or tests; UI still works in memory.
  }
}

export interface PlaybookUiState {
  selectedStepId: string | null;
  selectedIterationIndex: number;
  designerOpen: boolean;
  copilotMode: PlaybookCopilotMode;
  executionPanelOpen: boolean;
  executionDetailTab: string;
  workspaceExplorerOpen: boolean;
  connectorSidebarOpen: boolean;
  nodeEditorOpen: boolean;
  pageMode: PlaybookPageMode;
}

export interface PlaybookUiActions {
  selectStep: (taskId: string | null, iterationIndex?: number) => void;
  setPageMode: (mode: PlaybookPageMode) => void;
  setDesignerOpen: (open: boolean) => void;
  setCopilotMode: (mode: PlaybookCopilotMode) => void;
  setExecutionPanelOpen: (open: boolean) => void;
  setExecutionDetailTab: (tab: string) => void;
  openExecutionDetailTab: (tab: string, taskId?: string) => void;
  setWorkspaceExplorerOpen: (open: boolean) => void;
  setConnectorSidebarOpen: (open: boolean) => void;
  setNodeEditorOpen: (open: boolean) => void;
  reset: () => void;
}

export type PlaybookUiStore = PlaybookUiState & PlaybookUiActions;

export const initialPlaybookUiState: PlaybookUiState = {
  selectedStepId: null,
  selectedIterationIndex: 0,
  designerOpen: false,
  copilotMode: 'design',
  executionPanelOpen: readBooleanPreference(EXEC_PANEL_KEY),
  executionDetailTab: 'results',
  workspaceExplorerOpen: readBooleanPreference(WORKSPACE_EXPLORER_KEY),
  connectorSidebarOpen: false,
  nodeEditorOpen: false,
  pageMode: 'design',
};

export const usePlaybookUiStore = create<PlaybookUiStore>()(
  devtools(
    (set) => ({
      ...initialPlaybookUiState,
      selectStep: (taskId, iterationIndex) => set({ selectedStepId: taskId, selectedIterationIndex: iterationIndex ?? 0 }),
      setPageMode: (mode) => set({ pageMode: mode }),
      setDesignerOpen: (open) => set((state) => ({ designerOpen: open, copilotMode: open ? state.copilotMode : 'design' })),
      setCopilotMode: (mode) => set({ copilotMode: mode }),
      setExecutionPanelOpen: (open) => {
        set(open
          ? { executionPanelOpen: true, workspaceExplorerOpen: false, connectorSidebarOpen: false, nodeEditorOpen: false }
          : { executionPanelOpen: false });
        writeBooleanPreference(EXEC_PANEL_KEY, open);
      },
      setExecutionDetailTab: (tab) => set({ executionDetailTab: tab }),
      openExecutionDetailTab: (tab, taskId) => {
        set({
          executionDetailTab: tab,
          executionPanelOpen: true,
          workspaceExplorerOpen: false,
          connectorSidebarOpen: false,
          nodeEditorOpen: false,
          pageMode: 'run',
          ...(taskId ? { selectedStepId: taskId } : {}),
        });
        writeBooleanPreference(EXEC_PANEL_KEY, true);
      },
      setWorkspaceExplorerOpen: (open) => {
        set(open
          ? { workspaceExplorerOpen: true, connectorSidebarOpen: false, executionPanelOpen: false, nodeEditorOpen: false }
          : { workspaceExplorerOpen: false });
        writeBooleanPreference(WORKSPACE_EXPLORER_KEY, open);
      },
      setConnectorSidebarOpen: (open) => set(open
        ? { connectorSidebarOpen: true, workspaceExplorerOpen: false, executionPanelOpen: false, nodeEditorOpen: false }
        : { connectorSidebarOpen: false }),
      setNodeEditorOpen: (open) => set(open
        ? { nodeEditorOpen: true, workspaceExplorerOpen: false, connectorSidebarOpen: false, executionPanelOpen: false }
        : { nodeEditorOpen: false }),
      reset: () => set({
        ...initialPlaybookUiState,
        executionPanelOpen: readBooleanPreference(EXEC_PANEL_KEY),
        workspaceExplorerOpen: readBooleanPreference(WORKSPACE_EXPLORER_KEY),
      }),
    }),
    { name: 'playbook-ui-store' },
  ),
);

export const useSelectedStep = () => usePlaybookUiStore((s) => s.selectedStepId);
export const useSelectedIterationIndex = () => usePlaybookUiStore((s) => s.selectedIterationIndex);
export const useDesignerOpen = () => usePlaybookUiStore((s) => s.designerOpen);
export const useCopilotMode = () => usePlaybookUiStore((s) => s.copilotMode);
export const useExecutionPanelOpen = () => usePlaybookUiStore((s) => s.executionPanelOpen);
export const usePageMode = () => usePlaybookUiStore((s) => s.pageMode);
export const useWorkspaceExplorerOpen = () => usePlaybookUiStore((s) => s.workspaceExplorerOpen);
export const useNodeEditorOpen = () => usePlaybookUiStore((s) => s.nodeEditorOpen);
export const useConnectorSidebarOpen = () => usePlaybookUiStore((s) => s.connectorSidebarOpen);
