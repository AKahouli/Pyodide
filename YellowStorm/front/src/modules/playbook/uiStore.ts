import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type { PlaybookCopilotMode, PlaybookIntentConstructionStatus, PlaybookPageMode } from './types';

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
  skillSidebarOpen: boolean;
  nodeEditorOpen: boolean;
  graphPanelOpen: boolean;
  pageMode: PlaybookPageMode;
  assistantOperationPlaybookId: string | null;
  assistantOperationId: string | null;
  assistantOperationTarget: 'canonical' | 'advisor_preview' | null;
  assistantPreviewStatus: 'idle' | 'streaming' | 'ready' | 'applying' | 'discarding';
  assistantBaseDefinitionRevision: number | null;
  assistantConstructionId: string | null;
  assistantConstructionStatus: PlaybookIntentConstructionStatus;
  assistantConstructionProgress: string;
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
  setSkillSidebarOpen: (open: boolean) => void;
  setNodeEditorOpen: (open: boolean) => void;
  setGraphPanelOpen: (open: boolean) => void;
  setAssistantOperation: (operation: { playbookId: string; id: string; target: 'canonical' | 'advisor_preview'; baseDefinitionRevision: number; status: 'streaming' | 'ready' }) => void;
  setAssistantPreviewStatus: (status: PlaybookUiState['assistantPreviewStatus']) => void;
  clearAssistantOperation: () => void;
  setAssistantConstructionId: (id: string | null) => void;
  setAssistantConstructionStatus: (status: PlaybookIntentConstructionStatus) => void;
  setAssistantConstructionProgress: (progress: string) => void;
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
  skillSidebarOpen: false,
  nodeEditorOpen: false,
  graphPanelOpen: false,
  pageMode: 'design',
  assistantOperationPlaybookId: null,
  assistantOperationId: null,
  assistantOperationTarget: null,
  assistantPreviewStatus: 'idle',
  assistantBaseDefinitionRevision: null,
  assistantConstructionId: null,
  assistantConstructionStatus: 'idle',
  assistantConstructionProgress: '',
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
          ? { executionPanelOpen: true, workspaceExplorerOpen: false, connectorSidebarOpen: false, skillSidebarOpen: false, nodeEditorOpen: false }
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
          skillSidebarOpen: false,
          nodeEditorOpen: false,
          pageMode: 'run',
          ...(taskId ? { selectedStepId: taskId } : {}),
        });
        writeBooleanPreference(EXEC_PANEL_KEY, true);
      },
      setWorkspaceExplorerOpen: (open) => {
        set(open
          ? { workspaceExplorerOpen: true, connectorSidebarOpen: false, skillSidebarOpen: false, executionPanelOpen: false, nodeEditorOpen: false }
          : { workspaceExplorerOpen: false });
        writeBooleanPreference(WORKSPACE_EXPLORER_KEY, open);
      },
      setConnectorSidebarOpen: (open) => set(open
        ? { connectorSidebarOpen: true, skillSidebarOpen: false, workspaceExplorerOpen: false, executionPanelOpen: false, nodeEditorOpen: false }
        : { connectorSidebarOpen: false }),
      setSkillSidebarOpen: (open) => set(open
        ? { skillSidebarOpen: true, connectorSidebarOpen: false, workspaceExplorerOpen: false, executionPanelOpen: false, nodeEditorOpen: false }
        : { skillSidebarOpen: false }),
      setNodeEditorOpen: (open) => set(open
        ? { nodeEditorOpen: true, workspaceExplorerOpen: false, connectorSidebarOpen: false, skillSidebarOpen: false, executionPanelOpen: false }
        : { nodeEditorOpen: false }),
      setGraphPanelOpen: (open) => set({ graphPanelOpen: open }),
      setAssistantOperation: (operation) => set({
        assistantOperationPlaybookId: operation.playbookId,
        assistantOperationId: operation.id,
        assistantOperationTarget: operation.target,
        assistantBaseDefinitionRevision: operation.baseDefinitionRevision,
        assistantPreviewStatus: operation.status,
      }),
      setAssistantPreviewStatus: (status) => set({ assistantPreviewStatus: status }),
      clearAssistantOperation: () => set({
        assistantOperationPlaybookId: null,
        assistantOperationId: null,
        assistantOperationTarget: null,
        assistantPreviewStatus: 'idle',
        assistantBaseDefinitionRevision: null,
      }),
      setAssistantConstructionId: (id) => set({ assistantConstructionId: id }),
      setAssistantConstructionStatus: (status) => set({ assistantConstructionStatus: status }),
      setAssistantConstructionProgress: (progress) => set({ assistantConstructionProgress: progress }),
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
export const useGraphPanelOpen = () => usePlaybookUiStore((s) => s.graphPanelOpen);
export const useSkillSidebarOpen = () => usePlaybookUiStore((s) => s.skillSidebarOpen);
