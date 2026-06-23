import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';

import { autoLayoutTasks } from '../utils/auto-layout';
import { readPlaybookDefinitionFile, PlaybookImportError } from '../utils/playbookImport';
import { tasksToNodes } from '../hooks/helpers/node-serializer';
import type {
  DataBinding,
  Playbook,
  PlaybookDefinitionExport,
  PlaybookPageMode,
  PlaybookEdge,
  PlaybookTask,
} from '../types';

export interface UsePlaybookCanvasPageHandlersParams {
  id: string | undefined;
  playbook: Playbook | null;
  nameValue: string;
  nodeReflectionEnabled: boolean;
  advisorScoringMode: 'llm' | 'heuristic';
  advisorAutopilotEnabled: boolean;
  pageMode: PlaybookPageMode;
  designerOpen: boolean;
  confirmRemoveAllMessage: string;
  workspaceRequiredError: string;
  importReadErrorMessage: string;
  pendingImport: PlaybookDefinitionExport | null;

  setEditingName: Dispatch<SetStateAction<boolean>>;
  setNodeReflectionEnabled: (enabled: boolean) => void;
  setAdvisorScoringMode: (mode: 'llm' | 'heuristic') => void;
  setAdvisorAutopilotEnabled: (enabled: boolean) => void;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setPendingImport: Dispatch<SetStateAction<PlaybookDefinitionExport | null>>;
  setImportWarningOpen: Dispatch<SetStateAction<boolean>>;
  setExecutionPanelOpen: (open: boolean) => void;
  setExecutionPanelCollapsed: (collapsed: boolean) => void;
  setDesignerOpen: (open: boolean) => void;
  setEditorOpen: (open: boolean) => void;
  setPageMode: (mode: PlaybookPageMode) => void;
  setCopilotMode: (mode: 'design' | 'interrupt') => void;

  importFileInputRef: RefObject<HTMLInputElement | null>;
  updatePlaybook: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  exportPlaybookDefinition: (playbook: Playbook) => void;
  importPlaybookDefinition: (definition: PlaybookDefinitionExport) => void;
  updateTasks: (tasks: PlaybookTask[]) => void;
  updateEdges: (edges: PlaybookEdge[]) => void;
  updateDataBindings: (dataBindings: DataBinding[]) => void;
  captureSnapshot: () => void;
  showError: (message: string) => void;
  updateWorkspaces: (workspaces: string[]) => void;
}

export interface UsePlaybookCanvasPageHandlersResult {
  handleNodeReflectionChange: (enabled: boolean) => Promise<void>;
  handleAdvisorScoringModeChange: (mode: 'llm' | 'heuristic') => Promise<void>;
  handleAdvisorAutopilotChange: (enabled: boolean) => Promise<void>;
  handleAutoLayout: () => void;
  handleExportPlaybook: () => void;
  handleImportFileSelect: () => Promise<void>;
  handleImportConfirm: () => void;
  handleImportCancel: () => void;
  handleRemoveAllTasks: () => void;
  handleToggleCopilot: () => void;
  handlePageModeChange: (mode: PlaybookPageMode) => void;
  handleNameBlur: () => void;
  handleWorkspacesChange: (workspaces: string[]) => void;
}

function getAutopilotPayload(playbook: Playbook) {
  return {
    advisorAutopilotTargetScore: playbook.advisorAutopilotTargetScore ?? undefined,
    advisorAutopilotMaxTurns: playbook.advisorAutopilotMaxTurns ?? undefined,
  };
}

export function usePlaybookCanvasPageHandlers({
  id,
  playbook,
  nameValue,
  nodeReflectionEnabled,
  advisorScoringMode,
  advisorAutopilotEnabled,
  pageMode,
  designerOpen,
  confirmRemoveAllMessage,
  workspaceRequiredError,
  importReadErrorMessage,
  pendingImport,
  setEditingName,
  setNodeReflectionEnabled,
  setAdvisorScoringMode,
  setAdvisorAutopilotEnabled,
  setNodes,
  setEdges,
  setPendingImport,
  setImportWarningOpen,
  setExecutionPanelOpen,
  setExecutionPanelCollapsed,
  setDesignerOpen,
  setEditorOpen,
  setPageMode,
  setCopilotMode,
  importFileInputRef,
  updatePlaybook,
  exportPlaybookDefinition,
  importPlaybookDefinition,
  updateTasks,
  updateEdges,
  updateDataBindings,
  captureSnapshot,
  showError,
  updateWorkspaces,
}: UsePlaybookCanvasPageHandlersParams): UsePlaybookCanvasPageHandlersResult {
  const handleNodeReflectionChange = useCallback(async (enabled: boolean) => {
    const previous = nodeReflectionEnabled;
    setNodeReflectionEnabled(enabled);
    if (!id || !playbook) return;

    try {
      await updatePlaybook(id, {
        reflectionEnabled: enabled,
        advisorScoringMode,
        advisorAutopilotEnabled,
        ...getAutopilotPayload(playbook),
      });
    } catch {
      setNodeReflectionEnabled(previous);
    }
  }, [advisorAutopilotEnabled, advisorScoringMode, id, nodeReflectionEnabled, playbook, setNodeReflectionEnabled, updatePlaybook]);

  const handleAdvisorScoringModeChange = useCallback(async (mode: 'llm' | 'heuristic') => {
    const previous = advisorScoringMode;
    setAdvisorScoringMode(mode);
    if (!id || !playbook) return;

    try {
      await updatePlaybook(id, {
        advisorScoringMode: mode,
        reflectionEnabled: nodeReflectionEnabled,
        advisorAutopilotEnabled,
        ...getAutopilotPayload(playbook),
      });
    } catch {
      setAdvisorScoringMode(previous);
    }
  }, [advisorAutopilotEnabled, advisorScoringMode, id, nodeReflectionEnabled, playbook, setAdvisorScoringMode, updatePlaybook]);

  const handleAdvisorAutopilotChange = useCallback(async (enabled: boolean) => {
    const previous = advisorAutopilotEnabled;
    setAdvisorAutopilotEnabled(enabled);
    if (!id || !playbook) return;

    try {
      await updatePlaybook(id, {
        advisorAutopilotEnabled: enabled,
        ...getAutopilotPayload(playbook),
      });
    } catch {
      setAdvisorAutopilotEnabled(previous);
    }
  }, [advisorAutopilotEnabled, id, playbook, setAdvisorAutopilotEnabled, updatePlaybook]);

  const handleAutoLayout = useCallback(() => {
    if (!playbook) return;
    captureSnapshot();
    const layoutedTasks = autoLayoutTasks(playbook.tasks, playbook.edges);
    setNodes(tasksToNodes(layoutedTasks));
    updateTasks(layoutedTasks);
  }, [captureSnapshot, playbook, setNodes, updateTasks]);

  const handleExportPlaybook = useCallback(() => {
    if (!playbook) return;
    exportPlaybookDefinition(playbook);
  }, [playbook, exportPlaybookDefinition]);

  const handleImportFileSelect = useCallback(async () => {
    if (!importFileInputRef.current) return;
    const input = importFileInputRef.current;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const definition = await readPlaybookDefinitionFile(file);
      setPendingImport(definition);
      setImportWarningOpen(true);
    } catch (error) {
      const message = error instanceof PlaybookImportError ? error.message : importReadErrorMessage;
      showError(message);
    }
  }, [importFileInputRef, importReadErrorMessage, setImportWarningOpen, setPendingImport, showError]);

  const handleImportConfirm = useCallback(() => {
    if (!pendingImport) return;
    importPlaybookDefinition(pendingImport);
    setPendingImport(null);
    setImportWarningOpen(false);
  }, [importPlaybookDefinition, pendingImport, setPendingImport, setImportWarningOpen]);

  const handleImportCancel = useCallback(() => {
    setPendingImport(null);
    setImportWarningOpen(false);
  }, [setImportWarningOpen, setPendingImport]);

  const clearAllTasks = useCallback(() => {
    if (!playbook || playbook.tasks.length === 0) return;
    captureSnapshot();
    const includeTrigger = playbook.automatedTriggerType === 'mail';
    setNodes(includeTrigger ? [tasksToNodes([], true)[0]] : []);
    setEdges([]);
    updateTasks([]);
    updateEdges([]);
    updateDataBindings([]);
  }, [captureSnapshot, playbook, setEdges, setNodes, updateDataBindings, updateEdges, updateTasks]);

  const handleRemoveAllTasks = useCallback(() => {
    if (!playbook || playbook.tasks.length === 0) return;
    if (!window.confirm(confirmRemoveAllMessage)) return;
    clearAllTasks();
  }, [confirmRemoveAllMessage, clearAllTasks, playbook]);

  const handleToggleCopilot = useCallback(() => {
    const nextOpen = !designerOpen;
    if (nextOpen) {
      setCopilotMode(pageMode === 'run' ? 'interrupt' : 'design');
    }
    setDesignerOpen(nextOpen);
    if (nextOpen) {
      setEditorOpen(false);
    }
  }, [designerOpen, pageMode, setCopilotMode, setDesignerOpen, setEditorOpen]);

  const handlePageModeChange = useCallback((mode: PlaybookPageMode) => {
    setPageMode(mode);
    if (mode === 'design') {
      setCopilotMode('design');
      setDesignerOpen(true);
      setExecutionPanelCollapsed(true);
      setExecutionPanelOpen(false);
      return;
    }

    setDesignerOpen(false);
    setExecutionPanelCollapsed(false);
    setExecutionPanelOpen(true);
  }, [setCopilotMode, setDesignerOpen, setExecutionPanelCollapsed, setExecutionPanelOpen, setPageMode]);

  const handleNameBlur = useCallback(() => {
    setEditingName(false);
    if (id && nameValue.trim() && nameValue !== playbook?.name) {
      captureSnapshot();
      void updatePlaybook(id, { name: nameValue.trim() });
    }
  }, [captureSnapshot, id, nameValue, playbook?.name, setEditingName, updatePlaybook]);

  const handleWorkspacesChange = useCallback((workspaces: string[]) => {
    if (workspaces.length === 0) {
      showError(workspaceRequiredError);
      return;
    }

    captureSnapshot();
    updateWorkspaces(workspaces);
    if (id) {
      updatePlaybook(id, { workspaces });
    }
  }, [captureSnapshot, id, showError, updatePlaybook, updateWorkspaces, workspaceRequiredError]);

  return {
    handleNodeReflectionChange,
    handleAdvisorScoringModeChange,
    handleAdvisorAutopilotChange,
    handleAutoLayout,
    handleExportPlaybook,
    handleImportFileSelect,
    handleImportConfirm,
    handleImportCancel,
    handleRemoveAllTasks,
    handleToggleCopilot,
    handlePageModeChange,
    handleNameBlur,
    handleWorkspacesChange,
  };
}
