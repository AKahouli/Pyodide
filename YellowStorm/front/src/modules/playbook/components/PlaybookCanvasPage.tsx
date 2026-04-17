import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Share2, Copy, PanelRightOpen } from 'lucide-react';
import { ReactFlowProvider, useReactFlow, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Canvas } from '@/components/ai-elements/canvas';
import { Controls } from '@/components/ai-elements/controls';
import { Edge as AiEdge } from '@/components/ai-elements/edge';
import { Connection } from '@/components/ai-elements/connection';

import {
  usePlaybookStore,
  useCurrentPlaybook,
  useCurrentPlaybookLoading,
  useCurrentExecution,
  useLatestExecutionForPlaybook,
  useIsDirty,
  useIsSaving,
  useIsGenerating,
  useIsExecuting,
  useIsDesigning,
  useDesignerOpen,
  useHasActiveExecution,
  useExecutionPanelOpen,
  useWorkspaceExplorerOpen,
  usePageMode,
  useSelectedStep,
  useCanUndo,
  useCanRedo,
} from '../store';
import { ExecutionPanel } from './ExecutionPanel';
import { WorkspaceExplorerSidebar } from './WorkspaceExplorerSidebar';
import { useAgentStore } from '@/modules/agent/store';
import { autoLayoutTasks } from '../utils/auto-layout';
import { usePlaybookCanvas, tasksToNodes } from '../hooks/usePlaybookCanvas';
import { useAutosave } from '../hooks/useAutosave';
import { PlaybookNode, NodeContextMenuContext, NodeDataActionsContext, type NodeContextMenuActions, type ConnectorDropPayload } from './PlaybookNode';
import { PlaybookNodeEditor } from './PlaybookNodeEditor';
import { PlaybookToolbar } from './PlaybookToolbar';
import { PlaybookCanvasFloatingToolbar } from './PlaybookCanvasFloatingToolbar';
import { PlaybookWorkspaceSelect } from './PlaybookWorkspaceSelect';
import { PlaybookGeneratingOverlay } from './PlaybookGeneratingOverlay';
import { PlaybookDesignerPanel } from './PlaybookDesignerPanel';
import { PlaybookUsageIndicator } from './PlaybookUsageIndicator';
import { CloneShareDialog } from './CloneShareDialog';
import { ConnectorSidebar } from './ConnectorSidebar';
import { ConnectorBindingModal } from './ConnectorBindingModal';
import { downloadWorkflowExecutionResultsHtml } from '../utils/renderStepResultHtml';
import type { PlaybookTask, StepStatus, SemanticMatchResult, PlaybookPageMode, TaskTemplate, PlaybookNodeData, PlaybookExecution, ToolBinding } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import { useUsage } from '@/modules/usage';
import { PlaybookScheduleBadge } from './schedule/PlaybookScheduleBadge';
import { PlaybookScheduleSheet } from './schedule/PlaybookScheduleSheet';
import { toast } from 'sonner';

function PlaybookTriggersSheet(props: React.ComponentProps<typeof PlaybookScheduleSheet>) {
  return <PlaybookScheduleSheet {...props} />;
}

// Edge colors per step status
const EDGE_STYLES: Record<string, React.CSSProperties> = {
  completed: { stroke: 'var(--color-green-500)', strokeWidth: 2 },
  running: { stroke: 'var(--primary)', strokeWidth: 2, strokeDasharray: '6 3' },
  failed: { stroke: 'var(--destructive)', strokeWidth: 2 },
  interrupted: { stroke: 'var(--color-yellow-500)', strokeWidth: 2, strokeDasharray: '6 3' },
  pending: { stroke: 'var(--muted-foreground)', strokeWidth: 1, opacity: 0.4 },
  skipped: { stroke: 'var(--muted-foreground)', strokeWidth: 1, opacity: 0.3 },
};

function hasEdgeStyleChanged(edge: Edge, nextStyle: React.CSSProperties): boolean {
  const currentStyle = edge.style as React.CSSProperties | undefined;
  if (!currentStyle) return true;
  return currentStyle.stroke !== nextStyle.stroke
    || currentStyle.strokeWidth !== nextStyle.strokeWidth
    || currentStyle.strokeDasharray !== nextStyle.strokeDasharray
    || currentStyle.opacity !== nextStyle.opacity;
}

function normalizeTaskForExecutionReuse(task: Partial<PlaybookTask> | null | undefined) {
  if (!task) return null;
  return {
    id: task.id ?? '',
    title: task.title ?? '',
    description: task.description ?? '',
    assignedAgentId: task.assignedAgentId ?? null,
    interruptBefore: Boolean(task.interruptBefore),
    interruptAfter: Boolean(task.interruptAfter),
    allowClarification: Boolean(task.allowClarification),
    clarificationPrompt: task.clarificationPrompt ?? '',
    maxClarifications: task.maxClarifications ?? 0,
    inputKeys: [...(task.inputKeys || [])],
    outputKey: task.outputKey ?? '',
    enabled: task.enabled !== false,
    notifyOnComplete: Boolean(task.notifyOnComplete),
    notifyEmails: [...(task.notifyEmails || [])],
    stepReplayMode: task.stepReplayMode ?? 'live',
  };
}

function canReuseExecutionForTask(
  execution: { playbookSnapshot?: unknown } | null,
  task: Partial<PlaybookTask> | null | undefined,
): boolean {
  if (!execution || !task?.id) return false;
  const snapshotTasks = ((execution.playbookSnapshot as { tasks?: Partial<PlaybookTask>[] } | null)?.tasks) || [];
  const snapshotTask = snapshotTasks.find((candidate) => candidate.id === task.id);
  if (!snapshotTask) return true;
  return JSON.stringify(normalizeTaskForExecutionReuse(snapshotTask)) === JSON.stringify(normalizeTaskForExecutionReuse(task));
}

function getVisibleExecutionStatus(execution?: PlaybookExecution | null): PlaybookExecution['status'] | null {
  if (!execution) return null;
  if (execution.taskResults.some((taskResult) => taskResult.status === 'running')) return 'running';
  if (execution.taskResults.some((taskResult) => taskResult.status === 'interrupted')) return 'interrupted';
  return execution.status;
}

function getSnapshotTask(execution?: PlaybookExecution | null, taskId?: string | null): PlaybookTask | null {
  if (!execution || !taskId) return null;
  const snapshotTasks = ((execution.playbookSnapshot as { tasks?: PlaybookTask[] } | null)?.tasks) || [];
  return snapshotTasks.find((task) => task.id === taskId) || null;
}

function PlaybookCanvasInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useModuleTranslation('playbook');

  const playbook = useCurrentPlaybook();
  const playbookLoading = useCurrentPlaybookLoading();
  const currentExecution = useCurrentExecution();
  const execution = useLatestExecutionForPlaybook(id);
  const isDirty = useIsDirty();
  const isSaving = useIsSaving();
  const isGenerating = useIsGenerating();
  const isExecuting = useIsExecuting(id);
  const isDesigning = useIsDesigning();
  const designerOpen = useDesignerOpen();
  const hasActiveExecution = useHasActiveExecution(id);
  const executionPanelOpen = useExecutionPanelOpen();
  const workspaceExplorerOpen = useWorkspaceExplorerOpen();
  const pageMode = usePageMode();
  const selectedStepId = useSelectedStep();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const setDesignerOpen = usePlaybookStore((s) => s.setDesignerOpen);
  const setCopilotMode = usePlaybookStore((s) => s.setCopilotMode);
  const setWorkspaceExplorerOpen = usePlaybookStore((s) => s.setWorkspaceExplorerOpen);
  const setPageMode = usePlaybookStore((s) => s.setPageMode);
  const fetchPlaybook = usePlaybookStore((s) => s.fetchPlaybook);
  const fetchExecution = usePlaybookStore((s) => s.fetchExecution);
  const updatePlaybook = usePlaybookStore((s) => s.updatePlaybook);
  const clonePlaybook = usePlaybookStore((s) => s.clonePlaybook);
  const updateTasks = usePlaybookStore((s) => s.updateTasks);
  const updateEdges = usePlaybookStore((s) => s.updateEdges);
  const captureSnapshot = usePlaybookStore((s) => s.captureSnapshot);
  const undo = usePlaybookStore((s) => s.undo);
  const redo = usePlaybookStore((s) => s.redo);
  const fetchOutputFormatTemplate = usePlaybookStore((s) => s.fetchOutputFormatTemplate);
  const updateOutputFormatTemplate = usePlaybookStore((s) => s.updateOutputFormatTemplate);
  const updateWorkspaces = usePlaybookStore((s) => s.updateWorkspaces);
  const executePlaybook = usePlaybookStore((s) => s.executePlaybook);
  const rerunStepInExecution = usePlaybookStore((s) => s.rerunStepInExecution);
  const resumeFromStep = usePlaybookStore((s) => s.resumeFromStep);
  const skipExecutionStep = usePlaybookStore((s) => s.skipExecutionStep);
  const validateTaskReplay = usePlaybookStore((s) => s.validateTaskReplay);
  const grabOutputFormatTemplate = usePlaybookStore((s) => s.grabOutputFormatTemplate);
  const fetchExecutions = usePlaybookStore((s) => s.fetchExecutions);
  const { refreshUsage } = useUsage();

  const isGeneratingRoute = id === 'generating';

  const reactFlow = useReactFlow();
  const canvasChromeRef = useRef<HTMLDivElement | null>(null);

  const {
    nodes,
    edges,
    onNodesChange,
    onNodeDragStop,
    onEdgesChange,
    onConnect,
    addNode,
    removeNode,
    updateNodeData,
    setNodes,
    setEdges,
  } = usePlaybookCanvas();

  const { saveNow } = useAutosave();

  const [editingTask, setEditingTask] = useState<PlaybookTask | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [nodeReflectionEnabled, setNodeReflectionEnabled] = useState(true);
  const [advisorAutopilotEnabled, setAdvisorAutopilotEnabled] = useState(false);
  const [editingOutputFormatTaskId, setEditingOutputFormatTaskId] = useState<string | null>(null);
  const [editingOutputFormatVersion, setEditingOutputFormatVersion] = useState<number | null>(null);
  const [outputFormatDraft, setOutputFormatDraft] = useState('');
  const [outputFormatLoading, setOutputFormatLoading] = useState(false);
  const [outputFormatSaving, setOutputFormatSaving] = useState(false);
  const connectorSidebarOpen = usePlaybookStore((s) => s.connectorSidebarOpen);
  const setConnectorSidebarOpen = usePlaybookStore((s) => s.setConnectorSidebarOpen);
  const addToolBindingToTask = usePlaybookStore((s) => s.addToolBindingToTask);

  const [bindingModalState, setBindingModalState] = useState<{
    open: boolean;
    taskId: string;
    connectorId: string;
    connectorName: string;
    actions: Array<{ key: string; label: string }>;
    existingBinding: ToolBinding | null;
  } | null>(null);

  const [triggersSheetOpen, setTriggersSheetOpen] = useState(false);
  const [executionPanelCollapsed, setExecutionPanelCollapsed] = useState(false);

  useEffect(() => {
    if (id && !isGeneratingRoute) {
      // Reset execution state when switching playbooks, but preserve panel preference
      const panelPref = (() => { try { return localStorage.getItem('ys_playbook_exec_panel') === '1'; } catch { return false; } })();
      usePlaybookStore.setState({
        currentExecution: null,
        selectedStepId: null,
        executionPanelOpen: panelPref,
        executionHistory: [],
        pageMode: 'design',
      });
      setExecutionPanelCollapsed(false);
      fetchPlaybook(id);
      fetchExecutions(id);
    }
    // Ensure agents are loaded so nodes can display agent names
    useAgentStore.getState().fetchAgents();
  }, [id, isGeneratingRoute, fetchPlaybook, fetchExecutions]);

  useEffect(() => {
    if (searchParams.get('triggers') === '1' || searchParams.get('schedule') === '1') {
      setTriggersSheetOpen(true);
    }
  }, [searchParams]);

  // Fallback polling while an execution is active. This keeps both the canvas
  // and the detail pane in sync if an SSE step-complete/execution-complete event
  // is missed by the browser.
  useEffect(() => {
    if (!id || isGeneratingRoute) return;

    const selectedExecution = currentExecution?.playbookId === id ? currentExecution : null;
    const selectedVisibleStatus = getVisibleExecutionStatus(selectedExecution);
    const activeExecution = selectedExecution
      ? (selectedVisibleStatus === 'running' || selectedVisibleStatus === 'interrupted'
        ? selectedExecution
        : null)
      : execution && (getVisibleExecutionStatus(execution) === 'running' || getVisibleExecutionStatus(execution) === 'interrupted')
        ? execution
        : null;

    if (!activeExecution) return;

    const interval = setInterval(() => {
      void fetchExecution(id, activeExecution.id);
      void fetchExecutions(id);
    }, 2000);

    return () => clearInterval(interval);
  }, [
    id,
    isGeneratingRoute,
    execution?.id,
    execution?.status,
    currentExecution?.id,
    currentExecution?.status,
    currentExecution?.playbookId,
    fetchExecution,
    fetchExecutions,
  ]);

  // When generation completes, redirect to the real playbook URL
  useEffect(() => {
    if (isGeneratingRoute && !isGenerating && playbook) {
      navigate(`/playbooks/${playbook.id}`, { replace: true });
    }
  }, [isGeneratingRoute, isGenerating, playbook, navigate]);

  useEffect(() => {
    if (playbook) setNameValue(playbook.name);
  }, [playbook?.name]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) undo();
      }
      if (isMeta && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        if (canRedo) redo();
      }
      if (isMeta && e.key === 'y') {
        e.preventDefault();
        if (canRedo) redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, undo, redo]);

  // Refresh usage indicator when execution ends, generation or design completes
  const prevIsGenerating = useRef(isGenerating);
  const prevIsDesigning = useRef(isDesigning);
  useEffect(() => {
    const visibleStatus = getVisibleExecutionStatus(currentExecution?.playbookId === id ? currentExecution : execution);
    if (visibleStatus === 'completed' || visibleStatus === 'failed') {
      refreshUsage();
    }
    if (prevIsGenerating.current && !isGenerating) {
      refreshUsage();
    }
    if (prevIsDesigning.current && !isDesigning) {
      refreshUsage();
    }
    prevIsGenerating.current = isGenerating;
    prevIsDesigning.current = isDesigning;
  }, [currentExecution?.id, currentExecution?.status, currentExecution?.taskResults, execution?.id, execution?.status, execution?.taskResults, id, isGenerating, isDesigning, refreshUsage]);

  const nodeTypes = useMemo(() => ({ playbookStep: PlaybookNode }), []);
  const edgeTypes = useMemo(() => ({
    animated: AiEdge.Animated,
    'animated-warning': AiEdge.AnimatedWarning,
  }), []);
  const executionForCanvas =
    currentExecution?.playbookId === id
      ? currentExecution
      : execution;
  const executionTaskResults = executionForCanvas?.taskResults;
  const visibleExecutionStatus = getVisibleExecutionStatus(executionForCanvas);

  // Build step status map from the selected execution for this playbook
  const isLiveExecution = executionForCanvas &&
    (visibleExecutionStatus === 'running' || visibleExecutionStatus === 'interrupted');

  const stepStatusMap = useMemo(() => {
    const map = new Map<string, StepStatus>();
    if (!executionTaskResults) return map;
    for (const tr of executionTaskResults) {
      map.set(tr.taskId, tr.status);
    }
    return map;
  }, [executionTaskResults]);

  const stepSemanticMatchMap = useMemo(() => {
    const map = new Map<string, SemanticMatchResult | null>();
    if (!executionTaskResults) return map;
    for (const tr of executionTaskResults) {
      map.set(tr.taskId, tr.semanticMatch || null);
    }
    return map;
  }, [executionTaskResults]);

  const stepJudgeStatusMap = useMemo(() => {
    const map = new Map<string, NonNullable<PlaybookExecution['taskResults'][number]['judgeStatus']>>();
    if (!executionTaskResults) return map;
    for (const tr of executionTaskResults) {
      map.set(tr.taskId, tr.judgeStatus || 'idle');
    }
    return map;
  }, [executionTaskResults]);

  const stepJudgeResultMap = useMemo(() => {
    const map = new Map<string, PlaybookExecution['taskResults'][number]['judgeResult']>();
    if (!executionTaskResults) return map;
    for (const tr of executionTaskResults) {
      map.set(tr.taskId, tr.judgeResult || null);
    }
    return map;
  }, [executionTaskResults]);

  // Overlay step statuses onto nodes
  const liveNodes = useMemo(() => {
    return nodes.map((node) => {
      const status = stepStatusMap.get(node.id);
      const semanticMatch = stepSemanticMatchMap.get(node.id);
      const judgeStatus = stepJudgeStatusMap.get(node.id);
      const judgeResult = stepJudgeResultMap.get(node.id);
      const currentData = node.data as PlaybookNodeData;
      const nextSelected = node.id === selectedStepId;
      const nextData = {
        ...currentData,
        ...(status !== undefined ? { stepStatus: status } : {}),
        ...(semanticMatch !== undefined ? { stepSemanticMatch: semanticMatch } : {}),
        ...(judgeStatus !== undefined ? { stepJudgeStatus: judgeStatus } : {}),
        ...(judgeResult !== undefined ? { stepJudgeResult: judgeResult } : {}),
      } as PlaybookNodeData;

      const dataChanged = currentData.stepStatus !== nextData.stepStatus
        || currentData.stepSemanticMatch !== nextData.stepSemanticMatch
        || (currentData as any).stepJudgeStatus !== (nextData as any).stepJudgeStatus
        || (currentData as any).stepJudgeResult !== (nextData as any).stepJudgeResult;

      if (!dataChanged && node.selected === nextSelected) {
        return node;
      }

      return {
        ...node,
        selected: nextSelected,
        data: nextData,
      };
    });
  }, [nodes, selectedStepId, stepStatusMap, stepSemanticMatchMap, stepJudgeStatusMap, stepJudgeResultMap]);

  // Style edges based on source node status
  const liveEdges = useMemo(() => {
    if (stepStatusMap.size === 0) return edges;
    return edges.map((edge): Edge => {
      const sourceStatus = stepStatusMap.get(edge.source) ?? 'pending';
      const style = EDGE_STYLES[sourceStatus] || EDGE_STYLES.pending;
      if (!hasEdgeStyleChanged(edge, style)) {
        return edge;
      }
      return { ...edge, style };
    });
  }, [edges, stepStatusMap]);

  const handleAddStep = useCallback(() => {
    const taskId = crypto.randomUUID();
    const existingCount = playbook?.tasks.length || 0;

    // Place the new node at the center of the current viewport
    const canvasEl = document.querySelector('.react-flow');
    const w = canvasEl?.clientWidth ?? 800;
    const h = canvasEl?.clientHeight ?? 600;
    const center = reactFlow.screenToFlowPosition({ x: w / 2, y: h / 2 });

    const newTask: PlaybookTask = {
      id: taskId,
      title: `Step ${existingCount + 1}`,
      description: '',
      assignedAgentId: null,
      executionOrder: existingCount,
      positionX: center.x,
      positionY: center.y,
      interruptBefore: false,
      interruptAfter: false,
      allowClarification: false,
      clarificationPrompt: '',
      maxClarifications: 3,
      inputKeys: [],
      outputKey: '',
      enabled: true,
      notifyOnComplete: false,
      notifyEmails: [],
      inputFiles: [],
      taskType: 'generic',
      inputPorts: [
        { id: 'default', name: 'Input', artifactKind: 'text', required: false },
      ],
      outputPorts: [
        { id: 'default', name: 'Output', artifactKind: 'text' },
      ],
    };
    addNode(newTask);
  }, [addNode, playbook?.tasks.length, reactFlow]);

  const handleAddStepFromTemplate = useCallback(
    (template: TaskTemplate) => {
      const taskId = crypto.randomUUID();
      const existingCount = playbook?.tasks.length || 0;

      const canvasEl = document.querySelector('.react-flow');
      const w = canvasEl?.clientWidth ?? 800;
      const h = canvasEl?.clientHeight ?? 600;
      const center = reactFlow.screenToFlowPosition({ x: w / 2, y: h / 2 });

      const newTask: PlaybookTask = {
        id: taskId,
        title: `${template.title} ${existingCount + 1}`,
        description: template.description,
        assignedAgentId: null,
        executionOrder: existingCount,
        positionX: center.x,
        positionY: center.y,
        interruptBefore: false,
        interruptAfter: false,
        allowClarification: false,
        clarificationPrompt: '',
        maxClarifications: 3,
        inputKeys: [],
        outputKey: '',
        enabled: true,
        notifyOnComplete: false,
        notifyEmails: [],
        inputFiles: [],
        taskType: template.type,
        inputPorts: template.inputPorts.map((p) => ({ ...p })),
        outputPorts: template.outputPorts.map((p) => ({ ...p })),
      };
      addNode(newTask);
    },
    [addNode, playbook?.tasks.length, reactFlow],
  );

  const handleEditNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        setEditingTask(node.data as unknown as PlaybookTask);
        setEditorOpen(true);
      }
    },
    [nodes],
  );

  const handleCloneNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const sourceData = node.data as unknown as PlaybookTask;
      const clonedTask: PlaybookTask = {
        ...sourceData,
        id: crypto.randomUUID(),
        title: `${sourceData.title} (copy)`,
        executionOrder: nodes.length,
        positionX: node.position.x + 50,
        positionY: node.position.y + 80,
        enabled: sourceData.enabled !== false,
      };
      addNode(clonedTask);
    },
    [nodes, addNode],
  );

  const handleConnectorDrop = useCallback(
    (taskId: string, payload: ConnectorDropPayload) => {
      const task = playbook?.tasks.find((t) => t.id === taskId);
      const existingBinding = task?.toolBindings?.find((b) => b.connectorId === payload.connectorId) ?? null;
      setBindingModalState({
        open: true,
        taskId,
        connectorId: payload.connectorId,
        connectorName: payload.connectorName,
        actions: payload.actions,
        existingBinding,
      });
    },
    [playbook?.tasks],
  );

  const handleConnectorDragStart = useCallback(
    (payload: ConnectorDropPayload) => {
      /* no-op for now; can add visual feedback later */
    },
    [],
  );

  const handleBindingModalSave = useCallback(
    (taskId: string, binding: ToolBinding) => {
      addToolBindingToTask(taskId, binding);
    },
    [addToolBindingToTask],
  );

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      if (e.target !== e.currentTarget) return;
      try {
        const raw = e.dataTransfer.getData('application/json');
        if (!raw) return;
        const payload = JSON.parse(raw);
        if (payload?.type !== 'connector' || !payload?.connectorId) return;
        const taskId = crypto.randomUUID();
        const existingCount = playbook?.tasks.length || 0;
        const center = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const newTask: PlaybookTask = {
          id: taskId,
          title: `${payload.connectorName} Step`,
          description: '',
          assignedAgentId: null,
          executionOrder: existingCount,
          positionX: center.x,
          positionY: center.y,
          interruptBefore: false,
          interruptAfter: false,
          allowClarification: false,
          clarificationPrompt: '',
          maxClarifications: 3,
          inputKeys: [],
          outputKey: '',
          enabled: true,
          notifyOnComplete: false,
          notifyEmails: [],
          inputFiles: [],
          taskType: 'generic',
          inputPorts: [
            { id: 'default', name: 'Input', artifactKind: 'text', required: false },
          ],
          outputPorts: [
            { id: 'default', name: 'Output', artifactKind: 'text' },
          ],
        };
        addNode(newTask);
        const task = playbook?.tasks.find((t) => t.id === taskId);
        const existingBinding = task?.toolBindings?.find((b) => b.connectorId === payload.connectorId) ?? null;
        setBindingModalState({
          open: true,
          taskId,
          connectorId: payload.connectorId,
          connectorName: payload.connectorName,
          actions: payload.actions,
          existingBinding,
        });
      } catch { /* noop */ }
    },
    [playbook?.tasks.length, playbook?.tasks, reactFlow, addNode],
  );

  const handleExecuteStep = useCallback(
    async (nodeId: string) => {
      if (!id) return;
      if (isDirty) await saveNow();
      const node = nodes.find((n) => n.id === nodeId);
      const task = node?.data as unknown as PlaybookTask | undefined;
      const selectedStepMode = task?.stepReplayMode || 'live';
      const targetExecution =
        (currentExecution?.playbookId === id ? currentExecution : null)
        || execution
        || null;
      try {
        if (targetExecution) {
        await rerunStepInExecution(id, targetExecution.id, nodeId, false, selectedStepMode, true, nodeReflectionEnabled, advisorAutopilotEnabled);
          return;
        }
        await executePlaybook(id, {
          singleStepTaskId: nodeId,
          executionMode: 'live',
          stepExecutionModes: { [nodeId]: selectedStepMode },
          streaming: true,
          runNodeReflection: nodeReflectionEnabled,
          advisorAutopilotEnabled,
        });
      } catch {
        // handled in store
      }
    },
    [id, isDirty, saveNow, currentExecution, execution, rerunStepInExecution, executePlaybook, nodes, advisorAutopilotEnabled, nodeReflectionEnabled],
  );

  const handleResumeFromStep = useCallback(
    async (nodeId: string) => {
      if (!id) return;
      if (isDirty) await saveNow();
      const targetExecution =
        (currentExecution?.playbookId === id ? currentExecution : null)
        || execution
        || null;
      if (!targetExecution) return;
      try {
        await resumeFromStep(id, targetExecution.id, nodeId, true);
      } catch {
        // handled in store
      }
    },
    [id, isDirty, saveNow, currentExecution, execution, resumeFromStep],
  );

  const handleToggleEnabled = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const task = node.data as unknown as PlaybookTask;
      updateNodeData(nodeId, { enabled: task.enabled === false });
    },
    [nodes, updateNodeData],
  );

  const openOutputFormatEditor = useCallback(async (taskId: string) => {
    if (!id) return;
    setEditingOutputFormatTaskId(taskId);
    setEditingOutputFormatVersion(null);
    setOutputFormatDraft('');
    setOutputFormatLoading(true);
    try {
      const template = await fetchOutputFormatTemplate(id, taskId);
      setOutputFormatDraft(template?.formatGuide || '');
      setEditingOutputFormatVersion(template?.templateVersion || null);
    } finally {
      setOutputFormatLoading(false);
    }
  }, [fetchOutputFormatTemplate, id]);

  const closeOutputFormatDialog = useCallback((open: boolean) => {
    if (open) return;
    setEditingOutputFormatTaskId(null);
    setEditingOutputFormatVersion(null);
    setOutputFormatDraft('');
    setOutputFormatLoading(false);
    setOutputFormatSaving(false);
  }, []);

  const handleSaveOutputFormat = useCallback(async () => {
    if (!id || !editingOutputFormatTaskId) return;
    setOutputFormatSaving(true);
    try {
      const template = await updateOutputFormatTemplate(id, editingOutputFormatTaskId, {
        formatGuide: outputFormatDraft,
      });
      setOutputFormatDraft(template.formatGuide || '');
      setEditingOutputFormatVersion(template.templateVersion);
      setEditingOutputFormatTaskId(null);
    } finally {
      setOutputFormatSaving(false);
    }
  }, [editingOutputFormatTaskId, id, outputFormatDraft, updateOutputFormatTemplate]);

  const handleSkipStep = useCallback(
    async (nodeId: string) => {
      if (!id || !currentExecution || currentExecution.playbookId !== id) return;
      await skipExecutionStep(id, currentExecution.id, nodeId);
    },
    [id, currentExecution, skipExecutionStep],
  );

  const executionForNodeActions =
    currentExecution?.playbookId === id
      ? currentExecution
      : execution || null;

  const getTaskResultForNode = useCallback(
    (nodeId: string) => executionForNodeActions?.taskResults.find((tr) => tr.taskId === nodeId) || null,
    [executionForNodeActions],
  );

  const handleSaveBaseline = useCallback(
    async (nodeId: string) => {
      if (!id || !executionForNodeActions) return;
      const taskResult = getTaskResultForNode(nodeId);
      if (!taskResult || taskResult.status !== 'completed') return;
      await validateTaskReplay(id, nodeId, executionForNodeActions.id, { preserveOutputFormat: false });
    },
    [executionForNodeActions, getTaskResultForNode, id, validateTaskReplay],
  );

  const handleGrabOutputFormat = useCallback(
    async (nodeId: string) => {
      if (!id || !executionForNodeActions) return;
      const taskResult = getTaskResultForNode(nodeId);
      if (!taskResult || taskResult.status !== 'completed' || (!taskResult.output && !(taskResult.components?.length))) return;
      await grabOutputFormatTemplate(id, nodeId, { executionId: executionForNodeActions.id });
    },
    [executionForNodeActions, getTaskResultForNode, grabOutputFormatTemplate, id],
  );

  const canSaveBaseline = useCallback(
    (nodeId: string) => Boolean(executionForNodeActions && getTaskResultForNode(nodeId)?.status === 'completed'),
    [executionForNodeActions, getTaskResultForNode],
  );

  const canGrabOutputFormat = useCallback(
    (nodeId: string) => {
      const taskResult = getTaskResultForNode(nodeId);
      return Boolean(
        executionForNodeActions
        && taskResult?.status === 'completed'
        && (taskResult.output || taskResult.components?.length),
      );
    },
    [executionForNodeActions, getTaskResultForNode],
  );

  const canSkipStep = useCallback(
    (nodeId: string) => {
      if (!currentExecution || currentExecution.playbookId !== id) return false;
      return getVisibleExecutionStatus(currentExecution) === 'interrupted'
        && currentExecution.interruptPayload?.taskId === nodeId;
    },
    [currentExecution, id],
  );

  const canResumeFromStep = useCallback(
    (_nodeId: string) => {
      const targetExecution =
        (currentExecution?.playbookId === id ? currentExecution : null)
        || execution
        || null;
      if (!targetExecution) return false;
      const node = nodes.find((candidate) => candidate.id === _nodeId);
      const task = node?.data as unknown as PlaybookTask | undefined;
      const snapshotTasks = ((targetExecution.playbookSnapshot as { tasks?: Partial<PlaybookTask>[] } | null)?.tasks) || [];
      const snapshotTask = snapshotTasks.find((candidate) => candidate.id === task?.id);
      if (!snapshotTask) return false;
      if (!canReuseExecutionForTask(targetExecution, task)) return false;
      return getVisibleExecutionStatus(targetExecution) !== 'running';
    },
    [currentExecution, execution, id, nodes],
  );

  const activeExecutionForEditor = (currentExecution?.playbookId === id ? currentExecution : null) || execution || null;
  const lastSnapshotRef = useRef<{ key: string; task: PlaybookTask | null }>({ key: '', task: null });
  const effectiveEditingTask = useMemo(() => {
    if (!editingTask?.id) return editingTask;
    const snapshot = getSnapshotTask(activeExecutionForEditor, editingTask.id) || editingTask;
    const key = JSON.stringify(snapshot);
    if (lastSnapshotRef.current.key === key) {
      return lastSnapshotRef.current.task;
    }
    lastSnapshotRef.current = { key, task: snapshot };
    return snapshot;
  }, [activeExecutionForEditor, editingTask]);

  const nodeContextMenuActions = useMemo<NodeContextMenuActions>(
    () => ({
      onEdit: handleEditNode,
      onClone: handleCloneNode,
      onDelete: removeNode,
      onToggleEnabled: handleToggleEnabled,
      onExecuteStep: handleExecuteStep,
      onResumeFromStep: handleResumeFromStep,
      onSkipStep: handleSkipStep,
      onSaveBaseline: handleSaveBaseline,
      onGrabOutputFormat: handleGrabOutputFormat,
      canExecute: !hasActiveExecution && !isSaving && !isDirty,
      isExecuting,
      canResumeFromStep,
      canSkipStep,
      canSaveBaseline,
      canGrabOutputFormat,
    }),
    [
      handleEditNode,
      handleCloneNode,
      removeNode,
      handleToggleEnabled,
      handleExecuteStep,
      handleResumeFromStep,
      handleSkipStep,
      handleSaveBaseline,
      handleGrabOutputFormat,
      hasActiveExecution,
      isSaving,
      isDirty,
      isExecuting,
      canResumeFromStep,
      canSkipStep,
      canSaveBaseline,
      canGrabOutputFormat,
    ],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: any) => {
      setEditingTask(node.data);
      setEditorOpen(true);
      setDesignerOpen(false);
    },
    [setDesignerOpen],
  );

  const handleNodeSave = useCallback(
    (taskId: string, data: Partial<PlaybookTask>) => {
      updateNodeData(taskId, data);
    },
    [updateNodeData],
  );

  const handleRun = useCallback(async () => {
    if (!id || !playbook) return;
    if (!playbook.workspaces || playbook.workspaces.length === 0) {
      toast.error('Select a default playbook workspace before running this playbook.');
      return;
    }
    if (isDirty) await saveNow();
    setPageMode('run');
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
    });
  }, [id, playbook, isDirty, saveNow, executePlaybook, nodeReflectionEnabled, setPageMode]);

  const handleAutoLayout = useCallback(() => {
    if (!playbook) return;
    captureSnapshot();
    const layoutedTasks = autoLayoutTasks(playbook.tasks, playbook.edges);
    setNodes(tasksToNodes(layoutedTasks));
    updateTasks(layoutedTasks);
  }, [playbook, updateTasks, setNodes, captureSnapshot]);

  const handleToggleCopilot = useCallback(() => {
    const newOpen = !designerOpen;
    if (newOpen) {
      setCopilotMode(pageMode === 'run' ? 'interrupt' : 'design');
    }
    setDesignerOpen(newOpen);
    if (newOpen) setEditorOpen(false);
  }, [designerOpen, pageMode, setCopilotMode, setDesignerOpen]);

  const setExecutionPanelOpen = usePlaybookStore((s) => s.setExecutionPanelOpen);
  const selectStep = usePlaybookStore((s) => s.selectStep);
  const viewExecutionInPanel = usePlaybookStore((s) => s.viewExecutionInPanel);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: any) => {
      selectStep(node.id);

      const executionForSelection =
        currentExecution?.playbookId === id
          ? currentExecution
          : execution;

      if (executionForSelection) {
        setExecutionPanelCollapsed(false);
        setExecutionPanelOpen(true);
        viewExecutionInPanel(executionForSelection.id);
        setPageMode('run');
        return;
      }

      if (pageMode === 'design') {
        const targetNode = nodes.find((candidate) => candidate.id === node.id);
        if (targetNode) {
          setEditingTask(targetNode.data as unknown as PlaybookTask);
          setEditorOpen(true);
          setDesignerOpen(false);
        }
        return;
      }

      setExecutionPanelOpen(true);
    },
    [currentExecution, execution, id, nodes, pageMode, selectStep, setDesignerOpen, setExecutionPanelOpen, setPageMode, viewExecutionInPanel],
  );

  const handleEdgeDoubleClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      captureSnapshot();
      setEdges((currentEdges: Edge[]) => {
        const updated = currentEdges.filter((candidate) => candidate.id !== edge.id);
        updateEdges(
          updated.map((candidate) => ({
            id: candidate.id,
            sourceId: candidate.source,
            targetId: candidate.target,
            sourceOutputPortId: candidate.sourceHandle || ((candidate.data as any)?.sourceOutputPortId) || 'default',
            targetInputPortId: candidate.targetHandle || ((candidate.data as any)?.targetInputPortId) || 'default',
          })),
        );
        return updated;
      });
    },
    [captureSnapshot, setEdges, updateEdges],
  );

  const handleViewExecutions = useCallback(() => {
    const nextOpen = !executionPanelOpen;
    setExecutionPanelOpen(nextOpen);
    if (nextOpen) {
      setExecutionPanelCollapsed(false);
      setPageMode('run');
    } else if (pageMode !== 'design') {
      setPageMode('design');
    }
  }, [executionPanelOpen, pageMode, setExecutionPanelOpen, setPageMode]);

  const activeDownloadExecution = currentExecution?.playbookId === id ? currentExecution : execution;
  const handleDownloadAllResults = useCallback(() => {
    if (activeDownloadExecution) {
      downloadWorkflowExecutionResultsHtml(activeDownloadExecution);
    }
  }, [activeDownloadExecution]);

  const handlePageModeChange = useCallback(
    (mode: PlaybookPageMode) => {
      setPageMode(mode);
      if (mode === 'design') {
        return;
      }
      setExecutionPanelCollapsed(false);
      setExecutionPanelOpen(true);
    },
    [setExecutionPanelOpen, setPageMode],
  );

  const handleNameBlur = useCallback(() => {
    setEditingName(false);
    if (id && nameValue.trim() && nameValue !== playbook?.name) {
      captureSnapshot();
      updatePlaybook(id, { name: nameValue.trim() });
    }
  }, [id, nameValue, playbook?.name, updatePlaybook, captureSnapshot]);

  const handleWorkspacesChange = useCallback(
    (workspaces: string[]) => {
      if (workspaces.length === 0) {
        toast.error('Select at least one default workspace for this playbook.');
        return;
      }
      captureSnapshot();
      updateWorkspaces(workspaces);
      if (id) {
        updatePlaybook(id, { workspaces });
      }
    },
    [id, updateWorkspaces, updatePlaybook, captureSnapshot],
  );

  // Show generating overlay while waiting for AI
  if (isGeneratingRoute || isGenerating) {
    return (
      <div className="relative flex flex-col h-full w-full">
        {/* Empty canvas placeholder */}
        <div className="flex flex-wrap items-center gap-2 px-2 sm:px-4 py-2 border-b bg-background z-10">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate('/playbooks')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="h-5 w-40 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <div className="flex-1 bg-muted/20" />
        <PlaybookGeneratingOverlay />
      </div>
    );
  }

  if (!playbook || playbookLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isExecutionPanelVisible = !executionPanelCollapsed && (pageMode !== 'design' || executionPanelOpen);

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-2 sm:px-4 py-2 border-b bg-background z-10">
        {/* Left: back + name + live indicator */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate('/playbooks')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {editingName ? (
            <Input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleNameBlur()}
              className="h-8 w-40 sm:w-64"
              autoFocus
            />
          ) : (
            <h1
              className="text-base sm:text-lg font-semibold cursor-pointer hover:text-primary truncate"
              onClick={() => setEditingName(true)}
            >
              {playbook.name}
            </h1>
          )}
          <PlaybookScheduleBadge schedule={playbook.executionSchedule} />
          {isLiveExecution && (
            <span className="flex items-center gap-1 text-xs text-primary font-medium shrink-0">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="hidden sm:inline">{t('canvas.executionRunning')}</span>
            </span>
          )}
        </div>
        {/* Right: share + workspace select + usage + toolbar */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void (id && clonePlaybook(id))}
            title={t('header.clonePlaybook')}
            aria-label={t('header.clonePlaybook')}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShareDialogOpen(true)}
            title={t('share.share')}
          >
            <Share2 className="h-4 w-4" />
          </Button>
          <div className="w-40 sm:w-64">
            <PlaybookWorkspaceSelect
              value={playbook.workspaces || []}
              onChange={handleWorkspacesChange}
            />
          </div>
          <PlaybookUsageIndicator />
          <PlaybookToolbar
            pageMode={pageMode}
            onPageModeChange={handlePageModeChange}
            hasExecutionContext={Boolean(currentExecution || execution)}
            hasPendingInterrupt={Boolean(currentExecution?.interruptPayload)}
            onRun={handleRun}
            onSave={saveNow}
            onViewExecutions={handleViewExecutions}
            onToggleCopilot={handleToggleCopilot}
            copilotOpen={designerOpen}
            isDirty={isDirty}
            isSaving={isSaving}
            isExecuting={isExecuting}
            canRun={playbook.tasks.length > 0 && (playbook.workspaces?.length || 0) > 0 && !hasActiveExecution && !isSaving && !isDirty}
            nodeReflectionEnabled={nodeReflectionEnabled}
            onNodeReflectionChange={setNodeReflectionEnabled}
            advisorAutopilotEnabled={advisorAutopilotEnabled}
            onAdvisorAutopilotChange={setAdvisorAutopilotEnabled}
            onDownloadAllResults={handleDownloadAllResults}
            canDownloadAllResults={Boolean(activeDownloadExecution?.taskResults?.length)}
            onTriggers={() => setTriggersSheetOpen(true)}
          />
        </div>
      </div>

      {id && (
        <PlaybookTriggersSheet
          open={triggersSheetOpen}
          onOpenChange={setTriggersSheetOpen}
          playbookId={id}
          schedule={playbook.executionSchedule}
          mailTrigger={playbook.triggers.find((trigger) => trigger.type === 'mail') ?? null}
        />
      )}

      {/* Main content area with optional workspace explorer */}
      <div className="flex flex-1 overflow-hidden">
        {/* Workspace Explorer Sidebar */}
        <WorkspaceExplorerSidebar />

        {/* Connector Sidebar */}
        <ConnectorSidebar isOpen={connectorSidebarOpen} onDragStart={handleConnectorDragStart} />

        {/* Canvas + Execution split */}
        <div className="relative flex flex-1 min-h-0 overflow-hidden" key={isExecutionPanelVisible ? `${pageMode}-split` : `${pageMode}-full`}>
          <div ref={canvasChromeRef} className="relative flex-1 min-w-0 overflow-hidden">
            <NodeContextMenuContext.Provider value={nodeContextMenuActions}>
              <NodeDataActionsContext.Provider value={{ updateNodeData, openOutputFormatEditor, onConnectorDrop: handleConnectorDrop }}>
                <Canvas
                  nodes={liveNodes}
                  edges={liveEdges}
                  onNodesChange={onNodesChange}
                  onNodeDragStop={onNodeDragStop}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeClick={handleNodeClick}
                  onNodeDoubleClick={handleNodeDoubleClick}
                  onEdgeDoubleClick={handleEdgeDoubleClick}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  connectionLineComponent={Connection}
                  panOnDrag
                  panOnScroll={false}
                  zoomOnScroll
                  fitView
                  nodesDraggable={!isSaving}
                  nodesConnectable={!isSaving}
                  elementsSelectable={!isSaving}
                  onDrop={handleCanvasDrop}
                  onDragOver={(e) => { e.preventDefault(); }}
                >
                  <Controls />
                </Canvas>
                <PlaybookCanvasFloatingToolbar
                  containerRef={canvasChromeRef}
                  onAddStep={handleAddStep}
                  onAddStepFromTemplate={handleAddStepFromTemplate}
                  onAutoLayout={handleAutoLayout}
                  onUndo={undo}
                  onRedo={redo}
                  onToggleExplorer={() => setWorkspaceExplorerOpen(!workspaceExplorerOpen)}
                  onToggleConnectors={() => setConnectorSidebarOpen(!connectorSidebarOpen)}
                  explorerOpen={workspaceExplorerOpen}
                  connectorsOpen={connectorSidebarOpen}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  disabled={isSaving}
                />
              </NodeDataActionsContext.Provider>
            </NodeContextMenuContext.Provider>
            {isDesigning && (
              <PlaybookGeneratingOverlay
                title={t('canvas.designing')}
                subtitle={t('canvas.designingHint')}
              />
            )}
            <PlaybookDesignerPanel playbookId={id} />
          </div>

          {isExecutionPanelVisible && (
            <ExecutionPanel
              pageMode={pageMode}
              onCollapse={() => setExecutionPanelCollapsed(true)}
              onOpenOutputFormatEditor={(taskId) => {
                void openOutputFormatEditor(taskId);
              }}
            />
          )}

          {!isExecutionPanelVisible && (
            <div className="absolute right-3 top-3 z-20">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shadow-md bg-background"
                onClick={() => {
                  setExecutionPanelCollapsed(false);
                  setExecutionPanelOpen(true);
                }}
                title="Open execution sidebar"
                aria-label="Open execution sidebar"
              >
                <PanelRightOpen className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Node Editor Sheet */}
      <PlaybookNodeEditor
        playbookId={playbook.id}
        task={effectiveEditingTask}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSave={handleNodeSave}
      />

      {/* Share Dialog */}
      {id && (
        <CloneShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          playbookId={id}
        />
      )}

      <Dialog open={!!editingOutputFormatTaskId} onOpenChange={closeOutputFormatDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingOutputFormatVersion ? `Edit output format template v${editingOutputFormatVersion}` : 'Edit output format template'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Adjust the active output format template for this step. This is independent from replay baselines.
            </div>
            <Textarea
              value={outputFormatDraft}
              onChange={(e) => setOutputFormatDraft(e.target.value)}
              rows={18}
              disabled={outputFormatLoading || outputFormatSaving}
              placeholder={outputFormatLoading ? 'Loading template...' : 'Output format guide'}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => closeOutputFormatDialog(false)}
              disabled={outputFormatSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleSaveOutputFormat()}
              disabled={outputFormatLoading || outputFormatSaving || !outputFormatDraft.trim()}
            >
              {outputFormatSaving ? 'Saving...' : 'Save template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {bindingModalState?.open && (
        <ConnectorBindingModal
          open={bindingModalState.open}
          onOpenChange={(open) => {
            if (!open) setBindingModalState(null);
          }}
          taskId={bindingModalState.taskId}
          connectorId={bindingModalState.connectorId}
          connectorName={bindingModalState.connectorName}
          existingBinding={bindingModalState.existingBinding}
          onSave={handleBindingModalSave}
        />
      )}
    </div>
  );
}

export function PlaybookCanvasPage() {
  return (
    <ReactFlowProvider>
      <PlaybookCanvasInner />
    </ReactFlowProvider>
  );
}
