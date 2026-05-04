import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, Loader2, Share2, Copy, PanelRightOpen } from 'lucide-react';
import { ReactFlowProvider, useReactFlow, getNodesBounds, type Edge } from '@xyflow/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@xyflow/react/dist/style.css';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
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
  useExecutionHistoryForPlaybook,
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
  useIntentSuggestionHistory,
} from '../store';
import { ExecutionPanel } from './ExecutionPanel';
import { WorkspaceExplorerSidebar } from './WorkspaceExplorerSidebar';
import { useAgentStore, useDefaultAgents } from '@/modules/agent/store';
import { autoLayoutTasks } from '../utils/auto-layout';
import { usePlaybookCanvas, tasksToNodes, type TriggerNodeActions } from '../hooks/usePlaybookCanvas';
import { useAutosave } from '../hooks/useAutosave';
import { PlaybookNode, NodeContextMenuContext, NodeDataActionsContext, type NodeContextMenuActions, type ConnectorDropPayload } from './PlaybookNode';
import { PlaybookTriggerNode } from './PlaybookTriggerNode';
import { PlaybookNodeEditor } from './PlaybookNodeEditor';
import { PlaybookToolbar } from './PlaybookToolbar';
import { PlaybookCanvasFloatingToolbar } from './PlaybookCanvasFloatingToolbar';
import { PlaybookIntentBar } from './PlaybookIntentBar';
import { PlaybookWorkspaceSelect } from './PlaybookWorkspaceSelect';
import { PlaybookGeneratingOverlay } from './PlaybookGeneratingOverlay';
import { PlaybookDesignerPanel } from './PlaybookDesignerPanel';
import { PlaybookUsageIndicator } from './PlaybookUsageIndicator';
import { CloneShareDialog } from './CloneShareDialog';
import { ConnectorSidebar } from './ConnectorSidebar';
import { ConnectorBindingModal } from './ConnectorBindingModal';
import { RepeatabilityDetails } from './RepeatabilityDetails';
import { downloadWorkflowExecutionResultsHtml } from '../utils/renderStepResultHtml';
import { getPlaybookRepeatability } from '../api';
import type { PlaybookTask, StepStatus, SemanticMatchResult, PlaybookPageMode, TaskTemplate, PlaybookNodeData, PlaybookExecution, ToolBinding, PlaybookIntentSuggestion, PlaybookEdge, PlaybookTrigger, InterruptType } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import { useUsage } from '@/modules/usage';
import { PlaybookScheduleBadge } from './schedule/PlaybookScheduleBadge';
import { PlaybookScheduleSheet } from './schedule/PlaybookScheduleSheet';
import { showError } from '@/lib/notifications';

function PlaybookTriggersSheet(props: React.ComponentProps<typeof PlaybookScheduleSheet>) {
  return <PlaybookScheduleSheet {...props} />;
}

const AUTO_APPLY_MIN_CONFIDENCE = 0.75;
const CHANGE_HIGHLIGHT_DURATION_MS = 10_000;

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
  const isStopping = usePlaybookStore((s) => s.isStopping);
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
  const deleteOutputFormatTemplate = usePlaybookStore((s) => s.deleteOutputFormatTemplate);
  const updateWorkspaces = usePlaybookStore((s) => s.updateWorkspaces);
  const executePlaybook = usePlaybookStore((s) => s.executePlaybook);
  const stopExecution = usePlaybookStore((s) => s.stopExecution);
  const rerunStepInExecution = usePlaybookStore((s) => s.rerunStepInExecution);
  const resumeFromStep = usePlaybookStore((s) => s.resumeFromStep);
  const skipExecutionStep = usePlaybookStore((s) => s.skipExecutionStep);
  const selectStep = usePlaybookStore((s) => s.selectStep);
  const validateTaskReplay = usePlaybookStore((s) => s.validateTaskReplay);
  const deleteTaskReplay = usePlaybookStore((s) => s.deleteTaskReplay);
  const renameTaskReplay = usePlaybookStore((s) => s.renameTaskReplay);
  const grabOutputFormatTemplate = usePlaybookStore((s) => s.grabOutputFormatTemplate);
  const fetchExecutions = usePlaybookStore((s) => s.fetchExecutions);
  const pendingRerunTaskId = usePlaybookStore((s) => s.pendingRerunTaskId);
  const setPendingRerunTaskId = usePlaybookStore((s) => s.setPendingRerunTaskId);
  const executionHistory = useExecutionHistoryForPlaybook(id);
  const repeatability = usePlaybookStore((s) => s.repeatability);
  const repeatabilityLoading = usePlaybookStore((s) => s.repeatabilityLoading);
  const fetchRepeatability = usePlaybookStore((s) => s.fetchRepeatability);
  const clearPlaybookTriggerMail = usePlaybookStore((s) => s.clearPlaybookTriggerMail);
  const upsertPlaybookTriggerMail = usePlaybookStore((s) => s.upsertPlaybookTriggerMail);
  const { refreshUsage } = useUsage();

  const isGeneratingRoute = id === 'generating';

  const reactFlow = useReactFlow();
  const canvasChromeRef = useRef<HTMLDivElement | null>(null);
  const previousWaitingForHumanInputRef = useRef(false);

  const handleToggleTriggerEnabled = useCallback(
    async (playbookId: string, currentlyEnabled: boolean) => {
      const mailTrigger = playbook?.triggers.find((tr) => tr.type === 'mail') as
        | (PlaybookTrigger & { type: 'mail' })
        | undefined;
      if (!mailTrigger?.config) return;
      await upsertPlaybookTriggerMail(playbookId, {
        enabled: !currentlyEnabled,
        mailboxAppKey: mailTrigger.config.mailboxAppKey ?? undefined,
        autoRenewUntil: mailTrigger.config.autoRenewUntil,
        attachmentImportEnabled: mailTrigger.config.attachmentImportEnabled,
        allowedAttachmentExtensions: mailTrigger.config.allowedAttachmentExtensions,
        filters: {
          from: mailTrigger.config.filters.from,
          subjectContains: mailTrigger.config.filters.subjectContains,
          bodyContains: mailTrigger.config.filters.bodyContains,
          hasAttachments: mailTrigger.config.filters.hasAttachments,
        },
      });
    },
    [playbook?.triggers, upsertPlaybookTriggerMail],
  );

  const triggerNodeActions: TriggerNodeActions = useMemo(
    () => ({
      onDelete: async (playbookId: string) => {
        await clearPlaybookTriggerMail(playbookId);
      },
      onToggleEnabled: async (playbookId: string, currentlyEnabled: boolean) => {
        await handleToggleTriggerEnabled(playbookId, currentlyEnabled);
      },
      onEdit: () => {
        setTriggersSheetOpen(true);
      },
    }),
    [clearPlaybookTriggerMail, handleToggleTriggerEnabled],
  );

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
  } = usePlaybookCanvas(triggerNodeActions);

  const { saveNow } = useAutosave();

  const [editingTask, setEditingTask] = useState<PlaybookTask | null>(null);
  const editorOpen = usePlaybookStore((s) => s.nodeEditorOpen);
  const setEditorOpen = usePlaybookStore((s) => s.setNodeEditorOpen);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [evaluationDialogOpen, setEvaluationDialogOpen] = useState(false);
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
  const [executionPanelCollapsed, setExecutionPanelCollapsed] = useState(true);
  const requestPlaybookIntent = usePlaybookStore((s) => s.requestPlaybookIntent);
  const nodeTemplates = usePlaybookStore((s) => s.nodeTemplates);
  const defaultAgents = useDefaultAgents();
  const addIntentSuggestionHistoryEntry = usePlaybookStore((s) => s.addIntentSuggestionHistoryEntry);
  const intentHistory = useIntentSuggestionHistory(id);
  const [intentValue, setIntentValue] = useState('');
  const [intentSuggestions, setIntentSuggestions] = useState<PlaybookIntentSuggestion[]>([]);
  const [lastIntentSuggestions, setLastIntentSuggestions] = useState<PlaybookIntentSuggestion[]>([]);
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState('');
  const [intentAutoApply, setIntentAutoApply] = useState(true);
  const [recentlyChangedNodeIds, setRecentlyChangedNodeIds] = useState<string[]>([]);
  const [recentlyChangedEdgeIds, setRecentlyChangedEdgeIds] = useState<string[]>([]);
  const [highlightDismissArmed, setHighlightDismissArmed] = useState(false);
  const highlightTimeoutRef = useRef<number | null>(null);

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
      setExecutionPanelCollapsed(true);
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

  useEffect(() => {
    if (!evaluationDialogOpen || !id || isGeneratingRoute) return;

    void fetchRepeatability(id);
  }, [evaluationDialogOpen, id, isGeneratingRoute, fetchRepeatability]);

  // Fallback polling while an execution is active or while the run view is
  // recovering from a missed realtime handoff. This keeps both the canvas and
  // the detail pane in sync if an SSE step-complete/execution-complete event
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

    const latestHistoryExecution = execution?.playbookId === id ? execution : null;
    const recoveryExecution = !activeExecution
      && (pageMode === 'run' || executionPanelOpen)
      && latestHistoryExecution
      && (latestHistoryExecution.status === 'running' || latestHistoryExecution.status === 'interrupted')
        ? latestHistoryExecution
        : null;

    const executionToRefresh = activeExecution ?? recoveryExecution;

    if (!executionToRefresh) return;

    const interval = setInterval(() => {
      void fetchExecution(id, executionToRefresh.id);
      void fetchExecutions(id);
    }, 2000);

    return () => clearInterval(interval);
  }, [
    executionPanelOpen,
    id,
    isGeneratingRoute,
    execution?.id,
    execution?.status,
    execution?.playbookId,
    currentExecution?.id,
    currentExecution?.status,
    currentExecution?.taskResults,
    currentExecution?.playbookId,
    fetchExecution,
    fetchExecutions,
    pageMode,
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

  const nodeTypes = useMemo(() => ({ playbookStep: PlaybookNode, playbookTrigger: PlaybookTriggerNode }), []);
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

  // Overlay step statuses onto nodes.
  const TRIGGER_NODE_ID = '__trigger__';
  const mailTrigger = playbook?.triggers.find((tr) => tr.type === 'mail');

  const liveNodes = useMemo(() => {
    return nodes.map((node) => {
      if (node.id === TRIGGER_NODE_ID) {
        const nextSelected = node.id === selectedStepId;
        const triggerData = {
          ...(node.data as Record<string, unknown>),
          triggerActions: triggerNodeActions,
          playbookId: playbook?.id,
          enabled: mailTrigger?.enabled !== false,
        };
        return {
          ...node,
          selected: nextSelected,
          data: triggerData,
        };
      }

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
  }, [nodes, selectedStepId, stepStatusMap, stepSemanticMatchMap, stepJudgeStatusMap, stepJudgeResultMap, triggerNodeActions, playbook?.id, mailTrigger?.enabled]);

  // Style edges based on source node status
  const liveEdges = useMemo(() => {
    if (stepStatusMap.size === 0 && recentlyChangedEdgeIds.length === 0) return edges;
    return edges.map((edge): Edge => {
      const sourceStatus = stepStatusMap.get(edge.source) ?? 'pending';
      const style = EDGE_STYLES[sourceStatus] || EDGE_STYLES.pending;
      const isRecent = recentlyChangedEdgeIds.includes(edge.id);
      const nextStyle = isRecent
        ? {
            ...style,
            strokeDasharray: '10 6',
            animation: 'ys-edge-build 1.4s ease-out 1',
          }
        : style;
      if (!hasEdgeStyleChanged(edge, nextStyle) && (edge.data as Record<string, unknown> | undefined)?.isRecentlyChanged === isRecent) {
        return edge;
      }
      return {
        ...edge,
        style: nextStyle,
        data: {
          ...(edge.data || {}),
          isRecentlyChanged: isRecent,
        },
      };
    });
  }, [edges, recentlyChangedEdgeIds, stepStatusMap]);

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
      executionMode: 'agent',
      selectedAction: undefined,
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
        assignedAgentId: template.executionMode === 'agent' ? (template.assignedAgentId ?? null) : null,
        executionMode: (template.executionMode as PlaybookTask['executionMode']) ?? 'agent',
        selectedAction: template.executionMode === 'action' ? (template.selectedAction ?? undefined) : undefined,
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
      const taskFromPlaybook = playbook?.tasks.find((t) => t.id === nodeId) ?? null;
      const node = nodes.find((n) => n.id === nodeId);
      if (taskFromPlaybook) {
        setEditingTask(taskFromPlaybook);
        setEditorOpen(true);
        return;
      }
      if (node) {
        setEditingTask(node.data as unknown as PlaybookTask);
        setEditorOpen(true);
      }
    },
    [nodes, playbook?.tasks],
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
        stepReplayMode: 'live',
        hasValidatedReplay: undefined,
        activeReplayId: null,
        activeReplayVersion: null,
        activeReplayIsStale: undefined,
        activeReplayStaleReasons: undefined,
        activeReplayPreserveOutputFormat: undefined,
        activeReplayFormatGuideStatus: 'disabled',
        activeReplayFormatGuideError: null,
        activeReplayLabel: null,
        isSavingReplayBaseline: undefined,
        hasOutputFormatTemplate: undefined,
        activeOutputFormatTemplateId: null,
        activeOutputFormatTemplateVersion: null,
        activeOutputFormatStatus: null,
        activeOutputFormatError: null,
        isCapturingOutputFormat: undefined,
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
          executionMode: 'agent',
          selectedAction: undefined,
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
      const requiresExistingExecution = selectedStepMode !== 'live' || Boolean(task?.activeReplayId || task?.hasValidatedReplay);
      let targetExecution =
        (currentExecution?.playbookId === id ? currentExecution : null)
        || execution
        || null;

      if (!targetExecution) {
        const latestHistory = executionHistory.find(
          (e) => e.status === 'completed' || e.status === 'failed' || e.status === 'interrupted',
        );
        if (latestHistory) {
          await fetchExecution(id, latestHistory.id);
          targetExecution = usePlaybookStore.getState().executionCache[latestHistory.id] || null;
        }
      }

      try {
        if (targetExecution) {
          await rerunStepInExecution(id, targetExecution.id, nodeId, false, selectedStepMode, true, nodeReflectionEnabled, advisorAutopilotEnabled);
          return;
        }

        if (requiresExistingExecution) {
          showError(t('errors.replayStepRequiresReusableExecution'));
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
    [id, isDirty, saveNow, currentExecution, execution, executionHistory, fetchExecution, rerunStepInExecution, executePlaybook, nodes, advisorAutopilotEnabled, nodeReflectionEnabled],
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

  const handleRerunAfterOptimization = useCallback(async () => {
    if (!pendingRerunTaskId || !id) return;
    const taskId = pendingRerunTaskId;
    setPendingRerunTaskId(null);
    const node = nodes.find((n) => n.id === taskId);
    const task = node?.data as unknown as PlaybookTask | undefined;
    const selectedStepMode = task?.stepReplayMode || 'live';
    let targetExecution =
      (currentExecution?.playbookId === id ? currentExecution : null)
      || execution
      || null;

    if (!targetExecution) {
      const latestHistory = executionHistory.find(
        (e) => e.status === 'completed' || e.status === 'failed' || e.status === 'interrupted',
      );
      if (latestHistory) {
        await fetchExecution(id, latestHistory.id);
        targetExecution = usePlaybookStore.getState().executionCache[latestHistory.id] || null;
      }
    }

    if (!targetExecution) {
      showError(t('rerunPrompt.noExecution'));
      return;
    }

    try {
      await rerunStepInExecution(
        id,
        targetExecution.id,
        taskId,
        false,
        selectedStepMode,
        true,
        nodeReflectionEnabled,
        advisorAutopilotEnabled,
      );
    } catch {
      // handled in store
    }
  }, [
    pendingRerunTaskId,
    id,
    setPendingRerunTaskId,
    nodes,
    currentExecution,
    execution,
    executionHistory,
    fetchExecution,
    rerunStepInExecution,
    nodeReflectionEnabled,
    advisorAutopilotEnabled,
    t,
  ]);

  const handleDismissRerunPrompt = useCallback(() => {
    setPendingRerunTaskId(null);
  }, [setPendingRerunTaskId]);

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

  const handleRemoveOutputFormat = useCallback(async () => {
    if (!id || !editingOutputFormatTaskId) return;
    setOutputFormatSaving(true);
    try {
      await deleteOutputFormatTemplate(id, editingOutputFormatTaskId);
      setEditingOutputFormatTaskId(null);
      setEditingOutputFormatVersion(null);
      setOutputFormatDraft('');
    } finally {
      setOutputFormatSaving(false);
    }
  }, [deleteOutputFormatTemplate, editingOutputFormatTaskId, id]);

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

  const handleRemoveReplayBaseline = useCallback(
    async (playbookId: string, taskId: string, replayId: string) => {
      await deleteTaskReplay(playbookId, taskId, replayId);
    },
    [deleteTaskReplay],
  );

  const handleRenameReplayBaseline = useCallback(
    async (playbookId: string, taskId: string, replayId: string, label: string | null) => {
      await renameTaskReplay(playbookId, taskId, replayId, label);
    },
    [renameTaskReplay],
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
    const liveTask = playbook?.tasks.find((task) => task.id === editingTask.id) || null;
    const resolvedTask = liveTask || getSnapshotTask(activeExecutionForEditor, editingTask.id) || editingTask;
    const key = JSON.stringify(resolvedTask);
    if (lastSnapshotRef.current.key === key) {
      return lastSnapshotRef.current.task;
    }
    lastSnapshotRef.current = { key, task: resolvedTask };
    return resolvedTask;
  }, [activeExecutionForEditor, editingTask, playbook?.tasks]);

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
      onRemoveReplayBaseline: handleRemoveReplayBaseline,
      onRenameReplayBaseline: handleRenameReplayBaseline,
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
      handleRemoveReplayBaseline,
      handleRenameReplayBaseline,
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
      if (node.id === '__trigger__') {
        setTriggersSheetOpen(true);
        return;
      }
      const taskFromPlaybook = playbook?.tasks.find((t) => t.id === node.id) ?? null;
      setEditingTask(taskFromPlaybook || node.data);
      setEditorOpen(true);
      setDesignerOpen(false);
    },
    [playbook?.tasks, setDesignerOpen, setTriggersSheetOpen],
  );

  const handleNodeSave = useCallback(
    (taskId: string, data: Partial<PlaybookTask>) => {
      updateNodeData(taskId, data);
    },
    [updateNodeData],
  );

  const createProgrammaticEdge = useCallback((sourceId: string, targetId: string, sourceOutputPortId = 'default', targetInputPortId = 'default'): Edge => ({
    id: `e-${sourceId}-${sourceOutputPortId}-${targetId}-${targetInputPortId}`,
    source: sourceId,
    target: targetId,
    sourceHandle: sourceOutputPortId,
    targetHandle: targetInputPortId,
    type: 'animated',
    data: {
      sourceOutputPortId,
      targetInputPortId,
      isTypeMatch: undefined,
    },
  }), []);

  const clearChangeFeedback = useCallback(() => {
    setRecentlyChangedNodeIds([]);
    setRecentlyChangedEdgeIds([]);
    setHighlightDismissArmed(false);
  }, []);

  const scheduleChangeFeedbackCleanup = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightDismissArmed(true);
    }, CHANGE_HIGHLIGHT_DURATION_MS);
  }, []);

  const focusChangedArea = useCallback((layoutedTasks: PlaybookTask[], changedNodeIds: string[], fallbackBounds?: { x: number; y: number; width: number; height: number } | null) => {
    const changedNodes = layoutedTasks.filter((task) => changedNodeIds.includes(task.id)).map((task) => ({
      id: task.id,
      position: { x: task.positionX, y: task.positionY },
      width: 280,
      height: 180,
    }));

    const bounds = changedNodes.length > 0
      ? getNodesBounds(changedNodes as Parameters<typeof getNodesBounds>[0])
      : fallbackBounds;

    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    if (changedNodes.length > 0) {
      void reactFlow.fitView({
        nodes: changedNodes.map((node) => ({ id: node.id })),
        padding: 0.35,
        duration: 700,
        maxZoom: 1.35,
      });
    } else {
      void reactFlow.setCenter(bounds.x + (bounds.width / 2), bounds.y + (bounds.height / 2), {
        zoom: 1.1,
        duration: 700,
      });
    }

    scheduleChangeFeedbackCleanup();
  }, [reactFlow, scheduleChangeFeedbackCleanup]);

  const handleApplyIntentSuggestion = useCallback((suggestion: PlaybookIntentSuggestion) => {
    if (!playbook) return;

    const toPlaybookEdges = (nextEdges: Edge[]): PlaybookEdge[] => nextEdges.map((edge) => {
      const data = (edge.data || {}) as { sourceOutputPortId?: string; targetInputPortId?: string };
      return {
        id: edge.id,
        sourceId: edge.source,
        targetId: edge.target,
        sourceOutputPortId: data.sourceOutputPortId || edge.sourceHandle || 'default',
        targetInputPortId: data.targetInputPortId || edge.targetHandle || 'default',
      };
    });

    const resolveAssignedAgentId = (agentSlug?: string | null): string | null => {
      if (!agentSlug) {
        return null;
      }

      const storeAgents = useAgentStore.getState().agents;
      const matchingAgent = defaultAgents.find((agent) => agent.slug === agentSlug)
        || storeAgents.find((agent) => agent.isDefault && agent.slug === agentSlug)
        || storeAgents.find((agent) => agent.slug === agentSlug);

      return matchingAgent?.id || null;
    };

    const clonePortSet = <T extends { id: string }>(ports: T[] | undefined, fallback: T[]): T[] => {
      if (!ports || ports.length === 0) {
        return fallback;
      }
      return ports.map((port) => ({ ...port }));
    };

    const findMatchingTemplate = (title: string, description: string) => {
      const normalizedTitle = title.trim().toLowerCase();
      const normalizedDescription = description.trim().toLowerCase();

      return nodeTemplates.find((template) => {
        const templateTitle = template.title.trim().toLowerCase();
        const templateDescription = (template.description || '').trim().toLowerCase();
        return templateTitle === normalizedTitle
          || (templateTitle && normalizedTitle.startsWith(templateTitle))
          || (templateDescription && templateDescription === normalizedDescription);
      }) || null;
    };

    const getPreferredInputPortId = (task: PlaybookTask, index = 0) => task.inputPorts?.[index]?.id || task.inputPorts?.[0]?.id || 'default';
    const getPreferredOutputPortId = (task: PlaybookTask) => task.outputPorts?.[0]?.id || 'default';

    const createIntentTask = (title: string, description: string, agentSlug: string | null | undefined, anchorTask: PlaybookTask | null, order: number): PlaybookTask => {
      const matchedTemplate = findMatchingTemplate(title, description);

      return {
        id: crypto.randomUUID(),
        title,
        description,
        assignedAgentId: matchedTemplate?.executionMode === 'agent'
          ? (matchedTemplate.assignedAgentId ?? resolveAssignedAgentId(agentSlug))
          : resolveAssignedAgentId(agentSlug),
        executionMode: (matchedTemplate?.executionMode as PlaybookTask['executionMode']) ?? 'agent',
        selectedAction: matchedTemplate?.executionMode === 'action' ? (matchedTemplate.selectedAction ?? undefined) : undefined,
        executionOrder: order,
        positionX: (anchorTask?.positionX || 0) + 320,
        positionY: anchorTask?.positionY || 0,
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
        taskType: matchedTemplate?.type || 'generic',
        inputPorts: matchedTemplate
          ? clonePortSet(matchedTemplate.inputPorts, [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }])
          : clonePortSet(anchorTask?.inputPorts, [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }]),
        outputPorts: matchedTemplate
          ? clonePortSet(matchedTemplate.outputPorts, [{ id: 'default', name: 'Output', artifactKind: 'text' }])
          : clonePortSet(anchorTask?.outputPorts, [{ id: 'default', name: 'Output', artifactKind: 'text' }]),
      };
    };

    const changedNodeIds = new Set<string>();
    const changedEdgeIds = new Set<string>();

    const markEdgeChanged = (edge: Edge) => {
      changedEdgeIds.add(edge.id);
      return edge;
    };

    const commitGraph = (nextTasks: PlaybookTask[], nextEdges: Edge[]) => {
      const layoutedTasks = autoLayoutTasks(nextTasks, toPlaybookEdges(nextEdges));
      captureSnapshot();
      setNodes(tasksToNodes(layoutedTasks));
      setEdges(nextEdges);
      updateTasks(layoutedTasks);
      updateEdges(toPlaybookEdges(nextEdges));
      setIntentSuggestions([]);
      const changedIds = layoutedTasks.filter((task) => changedNodeIds.has(task.id)).map((task) => task.id);
      setRecentlyChangedNodeIds(changedIds);
      setRecentlyChangedEdgeIds(Array.from(changedEdgeIds));
      focusChangedArea(layoutedTasks, changedIds, deletedBounds);
    };

    const selectedTask = selectedStepId
      ? playbook.tasks.find((task) => task.id === selectedStepId) || null
      : null;

    if (selectedStepId && !selectedTask) {
      selectStep(null);
    }

    const singleChanges = suggestion.kind === 'single_change'
      ? [{
          type: suggestion.operationType === 'insert_before' || suggestion.operationType === 'insert_after' ? 'create_node' as const : suggestion.operationType,
          anchorMode: suggestion.operationType === 'insert_before' ? 'before' as const : suggestion.operationType === 'insert_after' ? 'after' as const : 'append' as const,
          targetTaskId: suggestion.targetTaskId || selectedTask?.id || null,
          task: suggestion.task,
        }]
      : [];

    if (suggestion.kind === 'workflow_plan' && suggestion.impact.nodesToDelete > 0 && !window.confirm(t('intentBar.confirmDeletePlan'))) {
      return;
    }

    let nextTasks = [...playbook.tasks];
    let nextEdges = [...edges];
    const createdNodeRefs = new Map<string, string>();
    let deletedBounds: { x: number; y: number; width: number; height: number } | null = null;

    const resolveTaskReference = (reference: string | null | undefined) => {
      if (!reference) return null;
      if (nextTasks.some((task) => task.id === reference)) {
        return reference;
      }
      return createdNodeRefs.get(reference) || null;
    };

    const resolveAnchorTask = (targetTaskId: string | null, nodeRef: string | null) => {
      const resolvedId = resolveTaskReference(targetTaskId) || resolveTaskReference(nodeRef);
      return resolvedId ? nextTasks.find((task) => task.id === resolvedId) || null : null;
    };

    const resolveAnchorTaskIds = (targetTaskId: string | null, nodeRef: string | null, targetTaskIds?: string[], nodeRefs?: string[]) => {
      const resolvedIds = [
        ...(resolveTaskReference(targetTaskId) ? [resolveTaskReference(targetTaskId) as string] : []),
        ...(resolveTaskReference(nodeRef) ? [resolveTaskReference(nodeRef) as string] : []),
        ...((targetTaskIds || []).map((ref) => resolveTaskReference(ref)).filter((ref): ref is string => Boolean(ref))),
        ...((nodeRefs || []).map((ref) => resolveTaskReference(ref)).filter((ref): ref is string => Boolean(ref))),
      ];

      return [...new Set(resolvedIds)].filter((id) => nextTasks.some((task) => task.id === id));
    };

    const applyCreate = (
      taskTitle: string,
      taskDescription: string,
      agentSlug: string | null | undefined,
      mode: 'append' | 'before' | 'after' | 'as_input',
      targetTaskId: string | null,
      nodeRef: string | null,
      newNodeRef: string | null,
      targetTaskIds?: string[],
      nodeRefs?: string[],
    ) => {
      const hasExplicitAnchors = Boolean(targetTaskId || nodeRef || (targetTaskIds || []).length || (nodeRefs || []).length);
      const anchorTaskIds = resolveAnchorTaskIds(targetTaskId, nodeRef, targetTaskIds, nodeRefs);
      const anchorTasks = anchorTaskIds.map((id) => nextTasks.find((task) => task.id === id)).filter((task): task is PlaybookTask => Boolean(task));
      const anchorTask = hasExplicitAnchors ? (anchorTasks[0] || null) : null;
      if (hasExplicitAnchors && anchorTasks.length === 0) {
        const newTask = createIntentTask(taskTitle, taskDescription, agentSlug, null, nextTasks.length);
        nextTasks = [...nextTasks, newTask];
        changedNodeIds.add(newTask.id);
        if (newNodeRef) {
          createdNodeRefs.set(newNodeRef, newTask.id);
        }
        return true;
      }

      const newTask = createIntentTask(taskTitle, taskDescription, agentSlug, anchorTask, nextTasks.length);
      nextTasks = [...nextTasks, newTask];
      changedNodeIds.add(newTask.id);
      if (newNodeRef) {
        createdNodeRefs.set(newNodeRef, newTask.id);
      }

      if (!anchorTask) {
        return true;
      }

        if (anchorTasks.length > 1) {
          nextEdges = [
            ...nextEdges,
          ...anchorTasks.map((task, index) => markEdgeChanged(createProgrammaticEdge(task.id, newTask.id, getPreferredOutputPortId(task), getPreferredInputPortId(newTask, index)))),
        ];
        return true;
      }

        if (mode === 'as_input') {
          nextEdges = [...nextEdges, markEdgeChanged(createProgrammaticEdge(newTask.id, anchorTask.id, getPreferredOutputPortId(newTask), getPreferredInputPortId(anchorTask)))];
          return true;
        }

      if (mode === 'before') {
        const incomingEdges = nextEdges.filter((edge) => edge.target === anchorTask.id);
        const untouchedEdges = nextEdges.filter((edge) => edge.target !== anchorTask.id);
          const rewiredIncoming = incomingEdges.map((edge) => {
            const data = (edge.data || {}) as { sourceOutputPortId?: string };
            return markEdgeChanged(createProgrammaticEdge(edge.source, newTask.id, data.sourceOutputPortId || edge.sourceHandle || 'default', getPreferredInputPortId(newTask)));
          });
        nextEdges = [...untouchedEdges, ...rewiredIncoming, markEdgeChanged(createProgrammaticEdge(newTask.id, anchorTask.id, getPreferredOutputPortId(newTask), getPreferredInputPortId(anchorTask)))];
          return true;
        }

        if (mode === 'after') {
          const outgoingEdges = nextEdges.filter((edge) => edge.source === anchorTask.id);
          const untouchedEdges = nextEdges.filter((edge) => edge.source !== anchorTask.id);
          const rewiredOutgoing = outgoingEdges.map((edge) => {
            const data = (edge.data || {}) as { targetInputPortId?: string };
            return markEdgeChanged(createProgrammaticEdge(newTask.id, edge.target, getPreferredOutputPortId(newTask), data.targetInputPortId || edge.targetHandle || 'default'));
          });
        nextEdges = [...untouchedEdges, markEdgeChanged(createProgrammaticEdge(anchorTask.id, newTask.id, getPreferredOutputPortId(anchorTask), getPreferredInputPortId(newTask))), ...rewiredOutgoing];
          return true;
        }

        nextEdges = [...nextEdges, markEdgeChanged(createProgrammaticEdge(anchorTask.id, newTask.id, getPreferredOutputPortId(anchorTask), getPreferredInputPortId(newTask)))];
        return true;
      };

    const deleteTaskAndBridgeEdges = (taskId: string) => {
      const deletedTask = nextTasks.find((task) => task.id === taskId) || null;
      if (deletedTask) {
        deletedBounds = {
          x: deletedTask.positionX,
          y: deletedTask.positionY,
          width: 280,
          height: 180,
        };
      }
      const incomingEdges = nextEdges.filter((edge) => edge.target === taskId);
      const outgoingEdges = nextEdges.filter((edge) => edge.source === taskId);
      const untouchedEdges = nextEdges.filter((edge) => edge.source !== taskId && edge.target !== taskId);
      const bridgedEdges = incomingEdges.flatMap((incomingEdge) => outgoingEdges.map((outgoingEdge) => {
        const incomingData = (incomingEdge.data || {}) as { sourceOutputPortId?: string };
        const outgoingData = (outgoingEdge.data || {}) as { targetInputPortId?: string };
        return markEdgeChanged(createProgrammaticEdge(
          incomingEdge.source,
          outgoingEdge.target,
          incomingData.sourceOutputPortId || incomingEdge.sourceHandle || 'default',
          outgoingData.targetInputPortId || outgoingEdge.targetHandle || 'default',
        ));
      })).filter((edge) => edge.source !== edge.target);
      const edgeById = new Map<string, Edge>();
      [...untouchedEdges, ...bridgedEdges].forEach((edge) => edgeById.set(edge.id, edge));
      nextTasks = nextTasks.filter((task) => task.id !== taskId);
      nextEdges = Array.from(edgeById.values());
    };

    const applyEdgeChange = (
      type: 'create_edge' | 'delete_edge',
      sourceTaskId: string | null,
      sourceNodeRef: string | null,
      targetTaskId: string | null,
      targetNodeRef: string | null,
    ) => {
      const resolvedSourceId = resolveTaskReference(sourceTaskId) || resolveTaskReference(sourceNodeRef);
      const resolvedTargetId = resolveTaskReference(targetTaskId) || resolveTaskReference(targetNodeRef);

      if (!resolvedSourceId || !resolvedTargetId || resolvedSourceId === resolvedTargetId) {
        return;
      }

      const sourceTask = nextTasks.find((task) => task.id === resolvedSourceId) || null;
      const targetTask = nextTasks.find((task) => task.id === resolvedTargetId) || null;
      if (!sourceTask || !targetTask) {
        return;
      }

      if (type === 'delete_edge') {
        nextEdges = nextEdges.filter((edge) => {
          const shouldDelete = edge.source === resolvedSourceId && edge.target === resolvedTargetId;
          if (shouldDelete) {
            changedEdgeIds.add(edge.id);
          }
          return !shouldDelete;
        });
        return;
      }

      if (nextEdges.some((edge) => edge.source === resolvedSourceId && edge.target === resolvedTargetId)) {
        return;
      }

      nextEdges = [
        ...nextEdges,
        markEdgeChanged(createProgrammaticEdge(
          resolvedSourceId,
          resolvedTargetId,
          getPreferredOutputPortId(sourceTask),
          getPreferredInputPortId(targetTask),
        )),
      ];
    };

    if (suggestion.kind === 'single_change') {
      const change = singleChanges[0];
      const targetTask = change.targetTaskId ? nextTasks.find((task) => task.id === change.targetTaskId) || null : selectedTask;
      if (change.type === 'delete_node') {
        if (!targetTask) {
          commitGraph(nextTasks, nextEdges);
          return;
        }
        deleteTaskAndBridgeEdges(targetTask.id);
        commitGraph(nextTasks, nextEdges);
        return;
      }
      if (change.type === 'update_node') {
        if (!targetTask) {
          commitGraph(nextTasks, nextEdges);
          return;
        }
        if (!change.task) return;
        nextTasks = nextTasks.map((task) => task.id === targetTask.id ? {
          ...task,
          title: change.task?.title || task.title,
          description: change.task?.description || task.description,
          assignedAgentId: change.task?.agentSlug ? resolveAssignedAgentId(change.task.agentSlug) : task.assignedAgentId,
        } : task);
        changedNodeIds.add(targetTask.id);
        commitGraph(nextTasks, nextEdges);
        return;
      }
      if (!change.task) return;
      applyCreate(change.task.title, change.task.description, change.task.agentSlug, change.anchorMode, change.targetTaskId, null, null);
      commitGraph(nextTasks, nextEdges);
      return;
    }

    const orderedChanges = [
      ...suggestion.changes.filter((change) => change.type !== 'delete_node' && change.type !== 'delete_edge'),
      ...suggestion.changes.filter((change) => change.type === 'delete_edge'),
      ...suggestion.changes.filter((change) => change.type === 'delete_node'),
    ];

    for (const change of orderedChanges) {
      if (change.type === 'create_node') {
        applyCreate(
          change.task.title,
          change.task.description,
          change.task.agentSlug,
          change.anchor.mode,
          change.anchor.targetTaskId,
          change.anchor.nodeRef,
          change.nodeRef,
          change.anchor.targetTaskIds,
          change.anchor.nodeRefs,
        );
        continue;
      }

      if (change.type === 'create_edge' || change.type === 'delete_edge') {
        applyEdgeChange(change.type, change.sourceTaskId, change.sourceNodeRef, change.targetTaskId, change.targetNodeRef);
        continue;
      }

        if (change.type === 'update_node') {
          if (nextTasks.some((task) => task.id === change.targetTaskId)) {
            nextTasks = nextTasks.map((task) => task.id === change.targetTaskId ? {
              ...task,
              ...(change.task.title ? { title: change.task.title } : {}),
              ...(change.task.description ? { description: change.task.description } : {}),
              assignedAgentId: change.task.agentSlug ? resolveAssignedAgentId(change.task.agentSlug) : task.assignedAgentId,
            } : task);
            changedNodeIds.add(change.targetTaskId);
        }
        continue;
      }

      if (change.type === 'delete_node' && nextTasks.some((task) => task.id === change.targetTaskId)) {
        deleteTaskAndBridgeEdges(change.targetTaskId);
      }
    }

    commitGraph(nextTasks, nextEdges);
  }, [captureSnapshot, createProgrammaticEdge, defaultAgents, edges, focusChangedArea, playbook, selectStep, selectedStepId, setEdges, setNodes, t, updateEdges, updateTasks]);

  const canvasNodes = useMemo(() => liveNodes.map((node) => ({
    ...node,
    data: {
      ...(node.data as PlaybookNodeData),
      isRecentlyChanged: recentlyChangedNodeIds.includes(node.id),
    },
  })), [liveNodes, recentlyChangedNodeIds]);

  const handleRun = useCallback(async () => {
    if (!id || !playbook) return;
    if (!playbook.workspaces || playbook.workspaces.length === 0) {
        showError(t('errors.workspaceRequiredForRun'));
        return;
    }
    if (isDirty) await saveNow();
    setPageMode('run');
    setExecutionPanelCollapsed(false);
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

  const handleStop = useCallback(async () => {
    const activeExec = currentExecution?.playbookId === id ? currentExecution : execution;
    if (!id || !activeExec) return;
    try {
      await stopExecution(id, activeExec.id);
    } catch {
      // handled in store
    }
  }, [id, currentExecution, execution, stopExecution]);

  const handleSubmitIntent = useCallback(async () => {
    const normalizedIntent = intentValue.trim();
    if (!id || normalizedIntent.length < 3) {
      return;
    }

    const resolvedSelectedTaskId = selectedStepId && playbook?.tasks.some((task) => task.id === selectedStepId)
      ? selectedStepId
      : undefined;

    if (selectedStepId && !resolvedSelectedTaskId) {
      selectStep(null);
    }

    setIntentLoading(true);
    setIntentError('');
    try {
      const result = await requestPlaybookIntent(id, {
        intent: normalizedIntent,
        selectedTaskId: resolvedSelectedTaskId,
      });
      const newSuggestions = result.suggestions || [];
      setLastIntentSuggestions(newSuggestions);
      const topSuggestion = newSuggestions.reduce<PlaybookIntentSuggestion | null>((best, suggestion) => {
        if (suggestion.isDirectIntentFallback) {
          return best;
        }
        if (!best || suggestion.confidence > best.confidence) {
          return suggestion;
        }
        return best;
      }, null);
      if (intentAutoApply && topSuggestion && topSuggestion.confidence >= AUTO_APPLY_MIN_CONFIDENCE) {
        handleApplyIntentSuggestion(topSuggestion);
        setIntentSuggestions([]);
      } else {
        setIntentSuggestions(newSuggestions);
      }
    } catch (error) {
      setIntentSuggestions([]);
      setLastIntentSuggestions([]);
      setIntentError(error instanceof Error ? error.message : t('intentBar.error'));
    } finally {
      setIntentLoading(false);
    }
  }, [handleApplyIntentSuggestion, id, intentAutoApply, intentValue, playbook?.tasks, requestPlaybookIntent, selectStep, selectedStepId, t]);

  useEffect(() => () => {
    if (typeof window === 'undefined') {
      return;
    }
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!playbook) return;
    setNodeReflectionEnabled(playbook.reflectionEnabled !== false);
  }, [playbook?.reflectionEnabled]);

  useEffect(() => {
    if (!playbook) return;
    setAdvisorAutopilotEnabled((playbook.advisorAutopilotEnabled ?? false) === true);
  }, [playbook?.advisorAutopilotEnabled]);

  const handleNodeReflectionChange = useCallback(
    async (enabled: boolean) => {
      setNodeReflectionEnabled(enabled);
      if (!id || !playbook) return;

      try {
        await updatePlaybook(id, {
          reflectionEnabled: enabled,
          advisorAutopilotEnabled: playbook.advisorAutopilotEnabled,
          advisorAutopilotTargetScore: playbook.advisorAutopilotTargetScore ?? undefined,
          advisorAutopilotMaxTurns: playbook.advisorAutopilotMaxTurns ?? undefined,
        });
      } catch {
      }
    },
    [id, playbook, updatePlaybook],
  );

  const handleAdvisorAutopilotChange = useCallback(
    async (enabled: boolean) => {
      setAdvisorAutopilotEnabled(enabled);
      if (!id || !playbook) return;

      try {
        await updatePlaybook(id, {
          advisorAutopilotEnabled: enabled,
          advisorAutopilotTargetScore: playbook.advisorAutopilotTargetScore ?? undefined,
          advisorAutopilotMaxTurns: playbook.advisorAutopilotMaxTurns ?? undefined,
        });
      } catch {
        // handled by the store/API layer
      }
    },
    [id, playbook, updatePlaybook],
  );

  const handleAutoLayout = useCallback(() => {
    if (!playbook) return;
    captureSnapshot();
    const layoutedTasks = autoLayoutTasks(playbook.tasks, playbook.edges);
    setNodes(tasksToNodes(layoutedTasks));
    updateTasks(layoutedTasks);
  }, [playbook, updateTasks, setNodes, captureSnapshot]);

  const handleRemoveAllTasks = useCallback(() => {
    if (!playbook || playbook.tasks.length === 0) return;
    if (!window.confirm(t('toolbar.confirmRemoveAllTitle') + '\n' + t('toolbar.confirmRemoveAllDescription'))) return;
    captureSnapshot();
    const includeTrigger = playbook.automatedTriggerType === 'mail';
    setNodes(includeTrigger ? [tasksToNodes([], true)[0]] : []);
    setEdges([]);
    updateTasks([]);
    updateEdges([]);
  }, [playbook, updateTasks, updateEdges, setNodes, setEdges, captureSnapshot, t]);

  const handleToggleCopilot = useCallback(() => {
    const newOpen = !designerOpen;
    if (newOpen) {
      setCopilotMode(pageMode === 'run' ? 'interrupt' : 'design');
    }
    setDesignerOpen(newOpen);
    if (newOpen) setEditorOpen(false);
  }, [designerOpen, pageMode, setCopilotMode, setDesignerOpen]);

  const waitingForHumanInput = currentExecution?.playbookId === id && currentExecution?.waitingForHumanInput === true;

  const setExecutionPanelOpen = usePlaybookStore((s) => s.setExecutionPanelOpen);
  const viewExecutionInPanel = usePlaybookStore((s) => s.viewExecutionInPanel);

  const handleIntentBarClick = useCallback(() => {
    setWorkspaceExplorerOpen(false);
    setConnectorSidebarOpen(false);
    setExecutionPanelOpen(false);
    setExecutionPanelCollapsed(true);
    if (intentSuggestions.length === 0 && lastIntentSuggestions.length > 0) {
      setIntentSuggestions(lastIntentSuggestions);
    }
  }, [
    intentSuggestions.length,
    lastIntentSuggestions,
    setConnectorSidebarOpen,
    setExecutionPanelOpen,
    setWorkspaceExplorerOpen,
  ]);

  useEffect(() => {
    const wasWaitingForHumanInput = previousWaitingForHumanInputRef.current;
    previousWaitingForHumanInputRef.current = Boolean(waitingForHumanInput);

    if (!waitingForHumanInput || wasWaitingForHumanInput) {
      return;
    }

    setDesignerOpen(true);
    setCopilotMode('interrupt');
  }, [setCopilotMode, setDesignerOpen, waitingForHumanInput]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: any) => {
      if (editorOpen) setEditorOpen(false);

      const executionForSelection =
        currentExecution?.playbookId === id
          ? currentExecution
          : execution;

      if (executionForSelection) {
        setExecutionPanelCollapsed(false);
        setExecutionPanelOpen(true);
        viewExecutionInPanel(executionForSelection.id);
        selectStep(node.id);
        setPageMode('run');
        return;
      }

      selectStep(node.id);

      if (pageMode === 'design') {
        return;
      }

      setExecutionPanelOpen(true);
    },
    [currentExecution, editorOpen, execution, id, pageMode, selectStep, setEditorOpen, setExecutionPanelOpen, setPageMode, viewExecutionInPanel],
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
        if (!waitingForHumanInput) {
          setDesignerOpen(false);
        }
        setExecutionPanelCollapsed(true);
        setExecutionPanelOpen(false);
        return;
      }
      setExecutionPanelCollapsed(false);
      setExecutionPanelOpen(true);
    },
    [setExecutionPanelOpen, setPageMode, setDesignerOpen, waitingForHumanInput],
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
        showError(t('errors.workspaceRequired'));
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
        {/* Right: share + workspace select + usage + evaluation + toolbar */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEvaluationDialogOpen(true)}
            title={t('header.evaluation')}
            aria-label={t('header.evaluation')}
          >
            <BarChart3 className="h-4 w-4" />
            <span className="hidden xl:inline">{t('header.evaluation')}</span>
          </Button>
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
            onStop={handleStop}
            onSave={saveNow}
            onViewExecutions={handleViewExecutions}
            isDirty={isDirty}
            isSaving={isSaving}
            isExecuting={isExecuting}
            hasActiveExecution={hasActiveExecution}
            isStopping={isStopping}
            canRun={playbook.tasks.length > 0 && (playbook.workspaces?.length || 0) > 0 && !hasActiveExecution && !isSaving && !isDirty}
            nodeReflectionEnabled={nodeReflectionEnabled}
            onNodeReflectionChange={handleNodeReflectionChange}
            advisorAutopilotEnabled={advisorAutopilotEnabled}
            onAdvisorAutopilotChange={handleAdvisorAutopilotChange}
            onTriggers={() => setTriggersSheetOpen(true)}
            triggersOpen={triggersSheetOpen}
            designSettings={playbook.designSettings}
            onDesignSettingsChange={(settings) => {
              void updatePlaybook(playbook.id, {
                designSettings: {
                  ...playbook.designSettings,
                  ...settings,
                },
              });
            }}
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
      <TooltipProvider delayDuration={300}>
      <div className="flex flex-1 overflow-hidden">
        {/* Workspace Explorer Sidebar */}
        <WorkspaceExplorerSidebar />

        {/* Connector Sidebar */}
        <ConnectorSidebar isOpen={connectorSidebarOpen} onDragStart={handleConnectorDragStart} />

        {/* Canvas + Execution split */}
        <div className="relative flex flex-1 min-h-0 overflow-hidden" key={isExecutionPanelVisible ? `${pageMode}-split` : `${pageMode}-full`}>
          <div
            ref={canvasChromeRef}
            className="relative flex-1 min-w-0 overflow-hidden"
            onMouseMove={() => {
              if (highlightDismissArmed) {
                clearChangeFeedback();
              }
            }}
          >
            <NodeContextMenuContext.Provider value={nodeContextMenuActions}>
              <NodeDataActionsContext.Provider value={{ updateNodeData, openOutputFormatEditor, onConnectorDrop: handleConnectorDrop }}>
                <Canvas
                  nodes={canvasNodes}
                  edges={liveEdges}
                  onNodesChange={onNodesChange}
                  onNodeDragStop={onNodeDragStop}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeClick={handleNodeClick}
                  onNodeDoubleClick={handleNodeDoubleClick}
                  onEdgeDoubleClick={handleEdgeDoubleClick}
                  onPaneClick={() => { if (editorOpen) setEditorOpen(false); }}
                  onPaneMouseMove={() => {
                    if (highlightDismissArmed) {
                      clearChangeFeedback();
                    }
                  }}
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
                <PlaybookIntentBar
                  selectedTask={playbook?.tasks.find((task) => task.id === selectedStepId) || null}
                  loading={intentLoading}
                  value={intentValue}
                  suggestions={intentSuggestions}
                  error={intentError}
                  history={intentHistory}
                  autoApply={intentAutoApply}
                  onValueChange={setIntentValue}
                  onAutoApplyChange={setIntentAutoApply}
                  onSubmit={() => void handleSubmitIntent()}
                  onApplySuggestion={handleApplyIntentSuggestion}
                  onRecordHistory={(suggestion, intent) => {
                    if (playbook) {
                      addIntentSuggestionHistoryEntry(playbook.id, playbook.name, suggestion, intent);
                    }
                  }}
                  onBarClick={handleIntentBarClick}
                />
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
                  onDownloadAllResults={handleDownloadAllResults}
                  canDownloadAllResults={Boolean(activeDownloadExecution?.taskResults?.length)}
                  onToggleDesigner={handleToggleCopilot}
                  designerOpen={designerOpen}
                  onRemoveAllTasks={handleRemoveAllTasks}
                  taskCount={playbook.tasks.length}
                  waitingForHumanInput={Boolean(waitingForHumanInput)}
                  interruptType={currentExecution?.playbookId === id
                    ? ((currentExecution?.interruptPayload?.type ?? null) as InterruptType | null)
                    : null}
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
              playbookId={id}
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
                title={t('execution.openSidebar')}
                aria-label={t('execution.openSidebar')}
              >
                <PanelRightOpen className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
      </TooltipProvider>

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

      <Dialog open={evaluationDialogOpen} onOpenChange={setEvaluationDialogOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-6xl grid-rows-[auto_minmax(0,1fr)] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('evaluationDialog.title')}</DialogTitle>
            <DialogDescription>{t('evaluationDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto pr-1">
            <RepeatabilityDetails
              repeatability={repeatability}
              loading={repeatabilityLoading}
              onPageFetch={(limit, offset) => fetchRepeatability(id!, limit, offset)}
              onExportFetch={(limit, offset) => getPlaybookRepeatability(id!, limit, offset)}
            />
          </div>
        </DialogContent>
      </Dialog>

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
              variant="destructive"
              onClick={() => void handleRemoveOutputFormat()}
              disabled={outputFormatLoading || outputFormatSaving || !editingOutputFormatVersion}
            >
              Remove
            </Button>
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

      <AlertDialog open={!!pendingRerunTaskId} onOpenChange={(open) => { if (!open) handleDismissRerunPrompt(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('rerunPrompt.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('rerunPrompt.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDismissRerunPrompt}>{t('rerunPrompt.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRerunAfterOptimization()}>{t('rerunPrompt.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
