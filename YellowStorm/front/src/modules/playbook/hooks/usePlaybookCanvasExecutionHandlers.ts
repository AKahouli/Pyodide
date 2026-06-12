import { useCallback } from 'react';

import type {
  ExecutePlaybookData,
  Playbook,
  PlaybookExecution,
  PlaybookPageMode,
} from '../types';

interface UsePlaybookCanvasExecutionHandlersParams {
  id?: string;
  playbook: Playbook | null;
  isDirty: boolean;
  saveNow: () => Promise<void>;
  nodeReflectionEnabled: boolean;
  executePlaybook: (id: string, data: ExecutePlaybookData) => Promise<string>;
  stopExecution: (playbookId: string, executionId: string) => Promise<void>;
  currentExecution: PlaybookExecution | null;
  execution: PlaybookExecution | null;
  setPageMode: (mode: PlaybookPageMode) => void;
  setExecutionPanelCollapsed: (isCollapsed: boolean) => void;
  setIntentBarCollapsed: (isCollapsed: boolean) => void;
  setDesignerOpen: (isOpen: boolean) => void;
  setWorkspaceExplorerOpen: (isOpen: boolean) => void;
  setConnectorSidebarOpen: (isOpen: boolean) => void;
  setGlobalSidebarOpen: (isOpen: boolean) => void;
  showError: (message: string) => void;
  workspaceRequiredForRunError: string;
}

interface UsePlaybookCanvasExecutionHandlersResult {
  handleRun: () => Promise<void>;
  handleStop: () => Promise<void>;
}

/**
 * Extract execution-oriented canvas actions to keep the page component focused.
 */
export const usePlaybookCanvasExecutionHandlers = ({
  id,
  playbook,
  isDirty,
  saveNow,
  nodeReflectionEnabled,
  executePlaybook,
  stopExecution,
  currentExecution,
  execution,
  setPageMode,
  setExecutionPanelCollapsed,
  setIntentBarCollapsed,
  setDesignerOpen,
  setWorkspaceExplorerOpen,
  setConnectorSidebarOpen,
  setGlobalSidebarOpen,
  showError,
  workspaceRequiredForRunError,
}: UsePlaybookCanvasExecutionHandlersParams): UsePlaybookCanvasExecutionHandlersResult => {
  const handleRun = useCallback(async () => {
    if (!id || !playbook) return;
    if (!playbook.workspaces || playbook.workspaces.length === 0) {
      showError(workspaceRequiredForRunError);
      return;
    }

    if (isDirty) {
      await saveNow();
    }

    setPageMode('run');
    setExecutionPanelCollapsed(false);
    setIntentBarCollapsed(true);
    setDesignerOpen(false);
    setWorkspaceExplorerOpen(false);
    setConnectorSidebarOpen(false);
    setGlobalSidebarOpen(false);

    const stepExecutionModes: Record<string, 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive'> = {};
    for (const task of playbook.tasks) {
      if (task.enabled !== false) {
        stepExecutionModes[task.id] = task.stepReplayMode || 'live';
      }
    }

    await executePlaybook(id, {
      executionMode: 'inherit',
      stepExecutionModes,
      streaming: true,
      runNodeReflection: nodeReflectionEnabled,
      advisorAutopilotEnabled: playbook.advisorAutopilotEnabled === true,
      advisorAutopilotTargetScore: playbook.advisorAutopilotTargetScore ?? undefined,
      advisorAutopilotMaxTurns: playbook.advisorAutopilotMaxTurns ?? undefined,
    });
  }, [
    id,
    isDirty,
    nodeReflectionEnabled,
    playbook,
    saveNow,
    setConnectorSidebarOpen,
    setDesignerOpen,
    setExecutionPanelCollapsed,
    setGlobalSidebarOpen,
    setIntentBarCollapsed,
    setPageMode,
    setWorkspaceExplorerOpen,
    showError,
    executePlaybook,
    workspaceRequiredForRunError,
  ]);

  const handleStop = useCallback(async () => {
    const activeExec = currentExecution?.playbookId === id ? currentExecution : execution;
    if (!id || !activeExec) return;
    try {
      await stopExecution(id, activeExec.id);
    } catch {
      // handled in store
    }
  }, [currentExecution, execution, id, stopExecution]);

  return { handleRun, handleStop };
};
