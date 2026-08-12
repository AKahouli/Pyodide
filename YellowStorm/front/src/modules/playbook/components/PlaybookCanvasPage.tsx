import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ArrowLeft, BarChart3, Loader2, Share2, Copy, PanelRightOpen } from 'lucide-react';
import { toast } from 'sonner';
import { ReactFlowProvider, useReactFlow, getNodesBounds, type Edge, type Node } from '@xyflow/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@xyflow/react/dist/style.css';

import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
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
import { usePlaybookUiStore } from '../uiStore';
import { ExecutionPanel } from './ExecutionPanel';
import { WorkspaceExplorerSidebar } from './WorkspaceExplorerSidebar';
import { CommunityGraphPanel } from './CommunityGraphPanel';
import { useAgentStore, useDefaultAgents } from '@/modules/agent/store';
import { autoLayoutTasks } from '../utils/auto-layout';
import { isIntentIteratorTask } from '../utils/intent-task-template';
import { usePlaybookCanvas, type TriggerNodeActions } from '../hooks/usePlaybookCanvas';
import { usePlaybookCanvasNodeHandlers, type PlaybookBindingModalState } from '../hooks/usePlaybookCanvasNodeHandlers';
import { usePlaybookCanvasPageHandlers } from '../hooks/usePlaybookCanvasPageHandlers';
import { usePlaybookCanvasExecutionHandlers } from '../hooks/usePlaybookCanvasExecutionHandlers';
import { usePlaybookCanvasOutputFormatHandlers } from '../hooks/usePlaybookCanvasOutputFormatHandlers';
import { flowEdgesToControlEdges, flowEdgesToPlaybookEdges } from '../hooks/helpers/control-edge-serializer';
import { dataBindingsToLayerEdges, filterMirroredDataLayerEdges } from '../hooks/helpers/data-binding-serializer';
import { tasksToNodes, TRIGGER_NODE_ID } from '../hooks/helpers/node-serializer';
import { useAutosave } from '../hooks/useAutosave';
import { PlaybookNode, NodeContextMenuContext, NodeDataActionsContext, ConnectionDragContext, type NodeContextMenuActions } from './PlaybookNode';
import { DynamicReasoningRuntimeNode } from './runtime/DynamicReasoningRuntimeNode';
import { DynamicReasoningRuntimeContainerNode } from './runtime/DynamicReasoningRuntimeContainerNode';
import { useExecutionFocusGraph } from '../hooks/useExecutionFocusGraph';
import { PlaybookTriggerNode } from './PlaybookTriggerNode';
import { PlaybookIteratorContainerNode } from './PlaybookIteratorContainerNode';

import { RouterNode } from './RouterNode';
import { HumanApprovalNode } from './HumanApprovalNode';
import { ConditionalEdge } from './ConditionalEdge';
import { DataBindingEdge } from './DataBindingEdge';
import { PlaybookOverviewCanvas } from './PlaybookOverviewCanvas';
import { PlaybookNodeEditor, type PlaybookNodeEditorHandle } from './PlaybookNodeEditor';
import { PlaybookToolbar } from './PlaybookToolbar';
import { PlaybookCanvasFloatingToolbar, type PlaybookCanvasFloatingToolbarHandle } from './PlaybookCanvasFloatingToolbar';
import { ReferenceModePromptDialog, type ReferenceModePromptState, type StepReplayMode } from './ReferenceModePromptDialog';
import { PlaybookIntentGhostNode } from './PlaybookIntentGhostNode';
import { PlaybookWorkspaceSelect } from './PlaybookWorkspaceSelect';
import { PlaybookGeneratingOverlay } from './PlaybookGeneratingOverlay';
import { PlaybookDesignerPanel } from './PlaybookDesignerPanel';
import { PlaybookNodeAdvisorDialog } from './PlaybookNodeAdvisorDialog';
import { PlaybookUsageIndicator } from './PlaybookUsageIndicator';
import { SharePlaybookDialog } from './SharePlaybookDialog';
import { ConnectorSidebar } from './ConnectorSidebar';
import { ConnectorBindingModal } from './ConnectorBindingModal';
import { SkillSidebar } from './SkillSidebar';
import { RepeatabilityDetails } from './RepeatabilityDetails';
import { ReplayMigrationHarnessCard } from './ReplayMigrationHarnessCard';
import { downloadWorkflowExecutionResultsHtml } from '../utils/renderStepResultHtml';
import {
  createIntentSuggestionApplicationKey,
  createIntentSuggestionBindingId,
  createIntentSuggestionNodeId,
} from '../utils/intent-application-key';
import { appendDesignMessage, cancelPlaybookIntentConstruction, discardPlaybookIntentConstruction, fetchPlaybookIntentConstruction, fetchPlaybookIntentTraces, getPlaybookRepeatability, requestPlaybookNodeAdvisor, runPlaybookAssistantTurn, startAdvisorRemediationConstruction, startPlaybookIntentConstruction, streamPlaybookIntentConstruction } from '../api';
import { playbookFeatures } from '../features';
import { getDefaultIteratorInputPorts, getDefaultIteratorOutputPorts } from '../hooks/helpers/node-serializer';
import type {
  PlaybookTask,
  SemanticMatchResult,
  PlaybookPageMode,
  PlaybookNodeData,
  PlaybookExecution,
  PlaybookIntentSuggestion,
  PlaybookIntentImageInput,
  PlaybookIntentDesignResponse,
  PlaybookIntentConstructionStatus,
  PlaybookIntentConstructionStartResponse,
  PlaybookIntentDiagnostic,
  PlaybookIntentTraceResponse,
  PlaybookUndoSnapshot,
  PlaybookTrigger,
  InterruptType,
  PlaybookIntentTaskDraft,
  PlaybookNodeAdvisorSuggestion,
  DataBinding,
  PlaybookDefinitionExport,
  TaskInputPort,
  TaskOutputPort,
  PlaybookNodeType,
} from '../types';
import { edgeMatchesIntentPortPair, getPreferredIntentInputPortId, getPreferredIntentOutputPortId, playbookEdgesToFlowEdges, resolveIntentEdgePorts } from '../hooks/helpers/control-edge-serializer';
import { useModuleTranslation } from '@/modules/localization';
import { useUsage } from '@/modules/usage/UsageContext';
import { PlaybookScheduleBadge } from './schedule/PlaybookScheduleBadge';
import { PlaybookScheduleSheet } from './schedule/PlaybookScheduleSheet';
import { PlaybookFlowSettingsDrawer } from './PlaybookFlowSettingsDrawer';
import { PlaybookImportWarningModal } from './PlaybookImportWarningModal';
import { ArtifactKindMismatchDialog } from './ArtifactKindMismatchDialog';
import { exportPlaybookDefinition } from '../utils/playbookExport';
import {
  DEFAULT_NODE_SPACING_X,
  EDGE_STYLES,
  TOOLBAR_MIN_LEFT_OFFSET,
  getIteratorBodyChildPosition,
  hasEdgeStyleChanged,
} from '../utils/playbook-canvas-layout';
import { resolveCanvasNodeSelection } from '../utils/playbook-canvas-selection';
import { usePlaybookIntentFlow } from '../utils/playbook-intent-flow';
import { getUnboundRequiredPortsForTaskIds } from '../utils/required-port-validation';
import type { PlaybookValidationIssue } from '../utils/required-port-validation';
import {
  buildCanvasJudgeStateMap,
  buildCanvasStepStatusMap,
  canExecuteSingleStep,
  canReuseExecutionForTask,
  getSnapshotTask,
  getVisibleExecutionStatus,
  hasPendingJudgeEvaluations,
} from '../utils/playbook-canvas-status';
import { showError, showWarning } from '@/lib/notifications';


function PlaybookTriggersSheet(props: React.ComponentProps<typeof PlaybookScheduleSheet>) {
  return <PlaybookScheduleSheet {...props} />;
}

const CHANGE_HIGHLIGHT_DURATION_MS = 10_000;
type CanvasViewMode = 'expanded' | 'overview';
type ExecutionViewMode = 'full' | 'focus';

export function shouldAutoLayoutAfterConstruction(
  previousStatus: PlaybookIntentConstructionStatus,
  currentStatus: PlaybookIntentConstructionStatus,
): boolean {
  return previousStatus !== 'completed' && currentStatus === 'completed';
}

export function shouldUsePlaybookAgentAssistant(enabled: boolean, images?: PlaybookIntentImageInput[]): boolean {
  return enabled && !images?.length;
}

export function shouldBlockCanvasMutationShortcut(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key'>,
  constructionActive: boolean,
): boolean {
  if (!constructionActive || (!event.ctrlKey && !event.metaKey)) return false;
  return ['z', 'y', 'x', 'v'].includes(event.key.toLowerCase());
}

export function shouldEnableCanvasNodeDragging(
  isSaving: boolean,
  constructionActive: boolean,
  executionViewMode: ExecutionViewMode,
): boolean {
  return !isSaving && !constructionActive && executionViewMode === 'full';
}

export async function hydrateAssistantOperationHandoff(
  playbookId: string,
  operationId: string,
  fetchOperation: typeof fetchPlaybookIntentConstruction,
  consumeOperation: (operation: PlaybookIntentConstructionStartResponse) => Promise<{ status: string; error?: string }>,
): Promise<void> {
  const operation = await fetchOperation(playbookId, operationId);
  const result = await consumeOperation({
    ...operation,
    constructionId: operation.operationId ?? operation.constructionId,
  });
  if (result.status === 'failed') throw new Error(result.error || 'Assistant operation could not be loaded');
}

export function buildIntentEdgeOptions(
  edgeKind?: 'sequential' | 'conditional',
  routerLabel?: string | null,
  priority?: number | null,
) {
  const isConditional = edgeKind === 'conditional' || Boolean(routerLabel);
  return {
    kind: isConditional ? 'conditional' as const : 'sequential' as const,
    routerLabel,
    priority,
    autoBind: !isConditional,
  };
}

export function remapRouterConditionSourceNodes(task: PlaybookTask, childRefs: Map<string, string>): PlaybookTask {
  const conditions = task.routerConfig?.conditions;
  if (!conditions?.length) return task;
  let changed = false;
  const nextConditions = conditions.map((condition) => {
    const sourceNode = condition.sourceNode ? childRefs.get(condition.sourceNode) : null;
    if (!sourceNode) return condition;
    changed = true;
    return { ...condition, sourceNode };
  });
  return changed ? { ...task, routerConfig: { ...task.routerConfig!, conditions: nextConditions } } : task;
}

export function resolveDiagnosticNodeId(
  diagnostic: PlaybookIntentDiagnostic,
  constructionId: string | null,
  tasks: PlaybookTask[],
): string | null {
  const target = diagnostic.reviewTarget;
  if (!target?.nodeRef) return null;
  if (constructionId) {
    const separator = target.nodeRef.indexOf('.');
    const logicalKey = separator > 0
      ? `${target.nodeRef.slice(0, separator)}:iterator:${target.nodeRef.slice(separator + 1)}`
      : target.nodeRef;
    const generatedId = createIntentSuggestionNodeId(`intent-construction-${constructionId}`, logicalKey);
    if (tasks.some((task) => task.id === generatedId)) return generatedId;
  }
  const matchingLabel = target.nodeLabel
    ? tasks.filter((task) => task.title === target.nodeLabel)
    : [];
  return matchingLabel.length === 1 ? matchingLabel[0].id : null;
}

export function resolveIntentNodeSemantics(
  explicitNodeType: PlaybookNodeType | null | undefined,
  explicitTaskType: string | null | undefined,
  templateNodeType: PlaybookNodeType | null | undefined,
  isIterator: boolean,
  hasRouterConfig = false,
  hasHumanApprovalConfig = false,
) {
  const nodeType = explicitNodeType
    ?? (hasRouterConfig ? 'router' : hasHumanApprovalConfig ? 'human_approval' : undefined)
    ?? (isIterator ? 'iterator' : templateNodeType ?? 'agent');
  const taskType = explicitTaskType ?? (nodeType === 'router'
    ? 'router'
    : nodeType === 'iterator'
      ? 'iterator'
      : nodeType === 'evaluation'
        ? 'evaluation'
        : 'generic');
  return { nodeType, taskType };
}

export function shouldApplyHomeAutoLayout(
  requested: boolean,
  routePlaybookId: string | undefined,
  loadedPlaybookId: string | null,
  currentPlaybookId: string | undefined,
  appliedPlaybookId: string | null,
): boolean {
  return requested
    && Boolean(routePlaybookId)
    && loadedPlaybookId === routePlaybookId
    && currentPlaybookId === routePlaybookId
    && appliedPlaybookId !== routePlaybookId;
}

export function buildOverviewResultNodeIds(
  taskResults: PlaybookExecution['taskResults'] | undefined,
): Set<string> {
  return new Set((taskResults ?? [])
    .filter((result) => result.status !== 'pending' && result.status !== 'running')
    .map((result) => result.taskId));
}

function PlaybookCanvasInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [canvasViewMode, setCanvasViewMode] = useState<CanvasViewMode>('expanded');
  const [executionViewMode, setExecutionViewMode] = useState<ExecutionViewMode>('full');
  const [loadedPlaybookId, setLoadedPlaybookId] = useState<string | null>(null);
  const { t } = useModuleTranslation('playbook');
  const { setOpen: setGlobalSidebarOpen } = useSidebar();

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
  const graphPanelOpen = usePlaybookStore((s) => s.graphPanelOpen);
  const setGraphPanelOpen = usePlaybookStore((s) => s.setGraphPanelOpen);
  const pageMode = usePageMode();
  const selectedStepId = useSelectedStep();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const setDesignerOpen = usePlaybookStore((s) => s.setDesignerOpen);
  const setCopilotMode = usePlaybookStore((s) => s.setCopilotMode);
  const setWorkspaceExplorerOpen = usePlaybookStore((s) => s.setWorkspaceExplorerOpen);
  const setPageMode = usePlaybookStore((s) => s.setPageMode);
  const fetchExecution = usePlaybookStore((s) => s.fetchExecution);
  const updatePlaybook = usePlaybookStore((s) => s.updatePlaybook);
  const clonePlaybook = usePlaybookStore((s) => s.clonePlaybook);
  const updateTasks = usePlaybookStore((s) => s.updateTasks);
  const updateEdges = usePlaybookStore((s) => s.updateEdges);
  const updateDataBindings = usePlaybookStore((s) => s.updateDataBindings);
  const captureSnapshot = usePlaybookStore((s) => s.captureSnapshot);
  const undo = usePlaybookStore((s) => s.undo);
  const redo = usePlaybookStore((s) => s.redo);
  const fetchOutputFormatTemplate = usePlaybookStore((s) => s.fetchOutputFormatTemplate);
  const refreshOutputFormatStatus = usePlaybookStore((s) => s.refreshOutputFormatStatus);
  const updateOutputFormatTemplate = usePlaybookStore((s) => s.updateOutputFormatTemplate);
  const deleteOutputFormatTemplate = usePlaybookStore((s) => s.deleteOutputFormatTemplate);
  const updateWorkspaces = usePlaybookStore((s) => s.updateWorkspaces);
  const executePlaybook = usePlaybookStore((s) => s.executePlaybook);
  const resumeFromStep = usePlaybookStore((s) => s.resumeFromStep);
  const runFromStep = usePlaybookStore((s) => s.runFromStep);
  const stopExecution = usePlaybookStore((s) => s.stopExecution);
  const selectStep = usePlaybookStore((s) => s.selectStep);
  const openExecutionDetailTab = usePlaybookStore((s) => s.openExecutionDetailTab);
  const validateTaskReplay = usePlaybookStore((s) => s.validateTaskReplay);
  const grabOutputFormatTemplate = usePlaybookStore((s) => s.grabOutputFormatTemplate);
  const fetchExecutions = usePlaybookStore((s) => s.fetchExecutions);
  const pendingRerunTaskId = usePlaybookStore((s) => s.pendingRerunTaskId);
  const setPendingRerunTaskId = usePlaybookStore((s) => s.setPendingRerunTaskId);
  const repeatability = usePlaybookStore((s) => s.repeatability);
  const repeatabilityLoading = usePlaybookStore((s) => s.repeatabilityLoading);
  const fetchRepeatability = usePlaybookStore((s) => s.fetchRepeatability);
  const clearPlaybookTriggerMail = usePlaybookStore((s) => s.clearPlaybookTriggerMail);
  const upsertPlaybookTriggerMail = usePlaybookStore((s) => s.upsertPlaybookTriggerMail);
  const { refreshUsage } = useUsage();

  const isGeneratingRoute = id === 'generating';

  const reactFlow = useReactFlow();
  const canvasChromeRef = useRef<HTMLDivElement | null>(null);
  const floatingToolbarRef = useRef<PlaybookCanvasFloatingToolbarHandle | null>(null);
  const canvasViewModeRef = useRef<HTMLDivElement | null>(null);
  const nodeEditorRef = useRef<PlaybookNodeEditorHandle | null>(null);
  const previousHumanInputKeyRef = useRef<string | null>(null);
  const viewportInitializedPlaybookRef = useRef<string | null>(null);
  const autoLayoutAppliedPlaybookRef = useRef<string | null>(null);
  const globalSidebarOpenRef = useRef(setGlobalSidebarOpen);

  useEffect(() => {
    globalSidebarOpenRef.current = setGlobalSidebarOpen;
  }, [setGlobalSidebarOpen]);

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
    onConnectStart,
    onConnectEnd,
    onNodeMouseEnter,
    onNodeMouseLeave,
    connectionDragHoveredId,
    addNode,
    removeNode,
    updateNodeData,
    setIteratorNodeSize,
    repackIteratorChildren,
    setNodes,
    setEdges,
    copySelection,
    cutSelection,
    pasteClipboard,
    artifactKindMismatch,
  } = usePlaybookCanvas(triggerNodeActions);

  useEffect(() => {
    const navigationState = location.state as { autoLayoutOnOpen?: boolean } | null;
    if (!shouldApplyHomeAutoLayout(
      navigationState?.autoLayoutOnOpen === true,
      id,
      loadedPlaybookId,
      playbook?.id,
      autoLayoutAppliedPlaybookRef.current,
    )) return;
    if (!playbook) return;

    autoLayoutAppliedPlaybookRef.current = id!;
    const layoutedTasks = autoLayoutTasks(playbook.tasks, playbook.edges);
    setNodes(tasksToNodes(layoutedTasks, playbook.automatedTriggerType === 'mail'));
    updateTasks(layoutedTasks);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [id, loadedPlaybookId, location.pathname, location.search, location.state, navigate, playbook, setNodes, updateTasks]);

  const saveCurrentPlaybook = usePlaybookStore((state) => state.saveCurrentPlaybook);

  const [editingTask, setEditingTask] = useState<PlaybookTask | null>(null);
  const [dataBindingsVisible, setDataBindingsVisible] = useState(false);
  const editorOpen = usePlaybookStore((s) => s.nodeEditorOpen);
  const setEditorOpen = usePlaybookStore((s) => s.setNodeEditorOpen);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [evaluationDialogOpen, setEvaluationDialogOpen] = useState(false);
  const [nodeAdvisorOpen, setNodeAdvisorOpen] = useState(false);
  const [referenceModePrompt, setReferenceModePrompt] = useState<ReferenceModePromptState>(null);
  const [nodeAdvisorLoading, setNodeAdvisorLoading] = useState(false);
  const [nodeAdvisorTaskId, setNodeAdvisorTaskId] = useState<string | null>(null);
  const [nodeAdvisorSuggestions, setNodeAdvisorSuggestions] = useState<PlaybookNodeAdvisorSuggestion[]>([]);
  const [nodeReflectionEnabled, setNodeReflectionEnabled] = useState(true);
  const [advisorScoringMode, setAdvisorScoringMode] = useState<'llm' | 'heuristic'>('llm');
  const [advisorAutopilotEnabled, setAdvisorAutopilotEnabled] = useState(false);
  const [editingOutputFormatTaskId, setEditingOutputFormatTaskId] = useState<string | null>(null);
  const [editingOutputFormatVersion, setEditingOutputFormatVersion] = useState<number | null>(null);
  const [outputFormatDraft, setOutputFormatDraft] = useState('');
  const [outputFormatLoading, setOutputFormatLoading] = useState(false);
  const [outputFormatSaving, setOutputFormatSaving] = useState(false);
  const [outputFormatGenerating, setOutputFormatGenerating] = useState(false);
  const connectorSidebarOpen = usePlaybookStore((s) => s.connectorSidebarOpen);
  const skillSidebarOpen = usePlaybookStore((s) => s.skillSidebarOpen);
  const setConnectorSidebarOpen = usePlaybookStore((s) => s.setConnectorSidebarOpen);
  const setSkillSidebarOpen = usePlaybookStore((s) => s.setSkillSidebarOpen);
  const setExecutionPanelOpen = usePlaybookStore((s) => s.setExecutionPanelOpen);
  const viewExecutionInPanel = usePlaybookStore((s) => s.viewExecutionInPanel);
  const addToolBindingToTask = usePlaybookStore((s) => s.addToolBindingToTask);
  const addSkillBindingToTask = usePlaybookStore((s) => s.addSkillBindingToTask);

  const [bindingModalState, setBindingModalState] = useState<PlaybookBindingModalState | null>(null);

  const [triggersSheetOpen, setTriggersSheetOpen] = useState(false);
  const [executionPanelCollapsed, setExecutionPanelCollapsed] = useState(true);
  const [flowSettingsOpen, setFlowSettingsOpen] = useState(false);
  const [importWarningOpen, setImportWarningOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<PlaybookDefinitionExport | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const importPlaybookDefinition = usePlaybookStore((s) => s.importPlaybookDefinition);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(true);
  const assessPlaybookIntentDesign = usePlaybookStore((s) => s.assessPlaybookIntentDesign);
  const nodeTemplates = usePlaybookStore((s) => s.nodeTemplates);
  const defaultAgents = useDefaultAgents();
  const intentHistory = useIntentSuggestionHistory(id);
  const [intentValue, setIntentValue] = useState('');
  const [intentSuggestions, setIntentSuggestions] = useState<PlaybookIntentSuggestion[]>([]);
  const [lastIntentSuggestions, setLastIntentSuggestions] = useState<PlaybookIntentSuggestion[]>([]);
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState('');
  const [constructionDiagnostics, setConstructionDiagnostics] = useState<PlaybookIntentDiagnostic[]>([]);
  const [intentDesign, setIntentDesign] = useState<PlaybookIntentDesignResponse | null>(null);
  const [intentTraces, setIntentTraces] = useState<PlaybookIntentTraceResponse | null>(null);
  const [intentTracesLoading, setIntentTracesLoading] = useState(false);
  const constructionStatus = usePlaybookUiStore((s) => s.assistantConstructionStatus);
  const constructionProgress = usePlaybookUiStore((s) => s.assistantConstructionProgress);
  const constructionId = usePlaybookUiStore((s) => s.assistantConstructionId);
  const setConstructionStatus = usePlaybookUiStore((s) => s.setAssistantConstructionStatus);
  const setConstructionProgress = usePlaybookUiStore((s) => s.setAssistantConstructionProgress);
  const setConstructionId = usePlaybookUiStore((s) => s.setAssistantConstructionId);
  const constructionAbortRef = useRef<AbortController | null>(null);
  const consumedAssistantOperationRef = useRef<string | null>(null);
  const constructionUndoCheckpointRef = useRef<{
    undoStack: PlaybookUndoSnapshot[];
    snapshot: PlaybookUndoSnapshot;
  } | null>(null);
  const designerIntentRef = useRef('');
  const designerIntentImagesRef = useRef<PlaybookIntentImageInput[]>([]);
  const [designerSidebarWidth, setDesignerSidebarWidth] = useState(0);
  const [runtimeContainerExpansion, setRuntimeContainerExpansion] = useState<Record<string, boolean>>({});
  const previousConstructionStatusRef = useRef<PlaybookIntentConstructionStatus>('idle');
  const autoIntentRef = useRef<string | null>(null);
  const constructionActive = constructionStatus === 'starting' || constructionStatus === 'streaming';
  const assistantOperationId = usePlaybookUiStore((s) => s.assistantOperationId);
  const assistantOperationTarget = usePlaybookUiStore((s) => s.assistantOperationTarget);
  const assistantPreviewStatus = usePlaybookUiStore((s) => s.assistantPreviewStatus);
  const assistantBaseDefinitionRevision = usePlaybookUiStore((s) => s.assistantBaseDefinitionRevision);
  const setAssistantOperation = usePlaybookUiStore((s) => s.setAssistantOperation);
  const setAssistantPreviewStatus = usePlaybookUiStore((s) => s.setAssistantPreviewStatus);
  const clearAssistantOperation = usePlaybookUiStore((s) => s.clearAssistantOperation);
  const { saveNow, validationIssues } = useAutosave({ paused: constructionActive || assistantPreviewStatus === 'ready' || assistantPreviewStatus === 'applying' || assistantPreviewStatus === 'discarding' });

  const [recentlyChangedNodeIds, setRecentlyChangedNodeIds] = useState<string[]>([]);
  const [recentlyChangedEdgeIds, setRecentlyChangedEdgeIds] = useState<string[]>([]);
  const [highlightDismissArmed, setHighlightDismissArmed] = useState(false);
  const highlightTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Ensure agents are loaded so nodes can display agent names
    void useAgentStore.getState().fetchAgents();

    if (id && !isGeneratingRoute) {
      let cancelled = false;
      setLoadedPlaybookId(null);
      const hasExecutionParam = searchParams.has('execution');

      // A normal playbook open always starts in the design view. Execution links restore the pane below.
      const workspaceExplorerPref = (() => { try { return localStorage.getItem('ys_workspace_explorer_open') === '1'; } catch { return false; } })();
      usePlaybookUiStore.setState({
        selectedStepId: null,
        selectedIterationIndex: 0,
        executionPanelOpen: false,
        workspaceExplorerOpen: workspaceExplorerPref,
        connectorSidebarOpen: false,
        nodeEditorOpen: false,
        designerOpen: true,
        copilotMode: 'design',
        pageMode: 'design',
      });
      usePlaybookStore.setState({
        currentExecution: null,
        selectedStepId: null,
        executionPanelOpen: false,
        workspaceExplorerOpen: workspaceExplorerPref,
        executionHistory: [],
        designerOpen: true,
        copilotMode: 'design',
        pageMode: 'design',
      });
      setExecutionPanelCollapsed(true);
      setToolbarCollapsed(true);
      setDataBindingsVisible(false);
      setIntentSuggestions([]);
      setLastIntentSuggestions([]);
      globalSidebarOpenRef.current(false);

      void (async () => {
        await Promise.all([
          usePlaybookStore.getState().fetchPlaybook(id),
          usePlaybookStore.getState().fetchExecutions(id),
        ]);
        if (!cancelled) setLoadedPlaybookId(id);
        if (cancelled || hasExecutionParam) {
          return;
        }

        setPageMode('design');
        setDesignerOpen(true);
        setCopilotMode('design');
        setExecutionPanelOpen(false);
        setExecutionPanelCollapsed(true);
        selectStep(null);
      })();

      return () => {
        cancelled = true;
      };
    }
  }, [fetchExecution, id, isGeneratingRoute, selectStep, setCopilotMode, setDesignerOpen, setExecutionPanelCollapsed, setExecutionPanelOpen, setPageMode, viewExecutionInPanel]);

  const refreshIntentTraces = useCallback(async () => {
    if (!id) return;
    setIntentTracesLoading(true);
    try {
      const traces = await fetchPlaybookIntentTraces(id);
      setIntentTraces(traces);
    } catch (error) {
      console.error('Failed to load intent traces', error);
    } finally {
      setIntentTracesLoading(false);
    }
  }, [id]);

  const handleOpenIntentTraces = useCallback(() => {
    void refreshIntentTraces();
  }, [refreshIntentTraces]);

  useEffect(() => {
    if (id) {
      void refreshIntentTraces();
    }
  }, [id, refreshIntentTraces]);

  useEffect(() => {
    if (searchParams.get('triggers') === '1' || searchParams.get('schedule') === '1') {
      setTriggersSheetOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const executionIdParam = searchParams.get('execution');
    if (!id || !executionIdParam || isGeneratingRoute) return;

    const taskIdParam = searchParams.get('task');
    const iterationParam = searchParams.get('iteration');
    const parsedIteration = iterationParam ? Number(iterationParam) : Number.NaN;

    setExecutionPanelCollapsed(false);
    setExecutionPanelOpen(true);
    setPageMode('run');

    void fetchExecution(id, executionIdParam).then(() => {
      const restoredExecution = usePlaybookStore.getState().executionCache[executionIdParam];
      if (!restoredExecution) {
        return;
      }

      viewExecutionInPanel(executionIdParam);
      if (taskIdParam) {
        selectStep(taskIdParam, Number.isFinite(parsedIteration) ? parsedIteration : undefined);
      }
      setSearchParams((prev) => {
        prev.delete('execution');
        prev.delete('task');
        prev.delete('iteration');
        return prev;
      }, { replace: true });
    });
  }, [fetchExecution, id, isGeneratingRoute, searchParams, selectStep, setExecutionPanelOpen, setPageMode, setSearchParams, viewExecutionInPanel]);

  useEffect(() => {
    const intent = searchParams.get('intent');
    if (!intent || intent.trim().length < 3 || isGeneratingRoute) return;
    autoIntentRef.current = intent.trim();
    setIntentValue(intent.trim());
    setSearchParams((prev) => { prev.delete('intent'); return prev; }, { replace: true });
  }, []);

  useEffect(() => {
    if (!evaluationDialogOpen || !id || isGeneratingRoute) return;

    void fetchRepeatability(id);
  }, [evaluationDialogOpen, id, isGeneratingRoute, fetchRepeatability]);

  useEffect(() => {
    if (viewportInitializedPlaybookRef.current === id) {
      return;
    }
    if (!id || isGeneratingRoute || playbookLoading || playbook?.id !== id || nodes.length === 0) {
      return;
    }

    let frameOne = 0;
    let frameTwo = 0;
    let zoomTimeout = 0;
    let cancelled = false;

    frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        void reactFlow.fitView({
          padding: 0.24,
          duration: 300,
          maxZoom: 1.1,
        });
        zoomTimeout = window.setTimeout(() => {
          if (cancelled) {
            return;
          }
          viewportInitializedPlaybookRef.current = id;
          void reactFlow.zoomOut({ duration: 180 });
        }, 320);
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
      window.clearTimeout(zoomTimeout);
    };
  }, [id, isGeneratingRoute, nodes.length, playbookLoading, playbook?.id, reactFlow]);

  useEffect(() => {
    if (executionPanelOpen && pageMode === 'run' && executionPanelCollapsed) {
      setExecutionPanelCollapsed(false);
    }
  }, [executionPanelOpen, pageMode, executionPanelCollapsed]);

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

    const terminalExecutionAwaitingJudges = !activeExecution
      && !recoveryExecution
      && selectedExecution
      && hasPendingJudgeEvaluations(selectedExecution)
        ? selectedExecution
        : !activeExecution
          && !recoveryExecution
          && latestHistoryExecution
          && hasPendingJudgeEvaluations(latestHistoryExecution)
            ? latestHistoryExecution
            : null;

    const executionToRefresh = activeExecution ?? recoveryExecution ?? terminalExecutionAwaitingJudges;

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
    execution?.taskResults,
    currentExecution?.id,
    currentExecution?.status,
    currentExecution?.taskResults,
    currentExecution?.playbookId,
    fetchExecution,
    fetchExecutions,
    pageMode,
  ]);

  // Detect externally-triggered executions (mail, schedule) while the page is
  // idle. SSE covers this in the normal case, but if the start event is missed
  // the page stays locked at idle until a manual refresh. This 5 s poll acts
  // as a safety net: it is intentionally slower than the 2 s active-run poll.
  const hasExternalTrigger = Boolean(playbook?.triggers.some((tr) => tr.enabled !== false));

  useEffect(() => {
    if (!id || isGeneratingRoute || !hasExternalTrigger || hasActiveExecution) return;

    const intervalId = setInterval(() => {
      void fetchExecutions(id).then(() => {
        const latest = usePlaybookStore.getState().executionHistoryByPlaybook[id]?.[0];
        if (latest && (latest.status === 'running' || latest.status === 'queued' || latest.status === 'interrupted')) {
          setPageMode('run');
          setExecutionPanelOpen(true);
          viewExecutionInPanel(latest.id);
        }
      });
    }, 5000);

    return () => clearInterval(intervalId);
  }, [
    id,
    isGeneratingRoute,
    hasExternalTrigger,
    hasActiveExecution,
    fetchExecutions,
    setPageMode,
    setExecutionPanelOpen,
    viewExecutionInPanel,
  ]);

  const hasPendingOutputFormat = Boolean(playbook?.tasks.some(
    (t) => t.isCapturingOutputFormat || t.activeOutputFormatStatus === 'pending',
  ));

  useEffect(() => {
    if (!id || !hasPendingOutputFormat) return;

    const pendingTaskIds = playbook!.tasks
      .filter((t) => t.isCapturingOutputFormat || t.activeOutputFormatStatus === 'pending')
      .map((t) => t.id);

    const intervalId = window.setInterval(() => {
      for (const taskId of pendingTaskIds) {
        void refreshOutputFormatStatus(id, taskId);
      }
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [id, hasPendingOutputFormat, playbook, refreshOutputFormatStatus]);

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
      if (shouldBlockCanvasMutationShortcut(e, constructionActive || canvasViewMode === 'overview')) {
        e.preventDefault();
        return;
      }
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

      const activeEl = document.activeElement;
      const isEditing = activeEl instanceof HTMLInputElement
        || activeEl instanceof HTMLTextAreaElement
        || activeEl instanceof HTMLSelectElement
        || (activeEl instanceof HTMLElement && activeEl.isContentEditable);
      if (isEditing) return;

      const canvasEl = canvasChromeRef.current;
      const inCanvas = canvasEl && activeEl && canvasEl.contains(activeEl);
      if (!inCanvas) return;

      if (isMeta && e.key === 'c') {
        e.preventDefault();
        void copySelection();
      }
      if (isMeta && e.key === 'x') {
        e.preventDefault();
        void cutSelection();
      }
      if (isMeta && e.key === 'v') {
        e.preventDefault();
        void pasteClipboard();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, canvasViewMode, constructionActive, undo, redo, copySelection, cutSelection, pasteClipboard]);

  // Refresh usage indicator when execution ends, generation or design completes
  const prevIsGenerating = useRef(isGenerating);
  const prevIsDesigning = useRef(isDesigning);
  const pendingInterruptFetchRef = useRef<string | null>(null);
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

  const nodeTypes = useMemo(() => ({
    playbookStep: PlaybookNode,
    playbookTrigger: PlaybookTriggerNode,
    playbookIteratorContainer: PlaybookIteratorContainerNode,
    playbookRouter: RouterNode,
    playbookHumanApproval: HumanApprovalNode,
    playbookRuntimeStep: DynamicReasoningRuntimeNode,
    dynamicReasoningRuntimeContainer: DynamicReasoningRuntimeContainerNode,
  }), []);
  const edgeTypes = useMemo(() => ({
    animated: AiEdge.Animated,
    'animated-warning': AiEdge.AnimatedWarning,
    conditional: ConditionalEdge,
    dataBinding: DataBindingEdge,
  }), []);
  const executionForCanvas =
    currentExecution?.playbookId === id
      ? currentExecution
      : execution;
  const executionTaskResults = executionForCanvas?.taskResults;
  const visibleExecutionStatus = getVisibleExecutionStatus(executionForCanvas);
  const snapshotTasks = ((executionForCanvas?.playbookSnapshot as { tasks?: PlaybookTask[] } | null)?.tasks) || [];
  const canvasStatusTasks = playbook?.tasks?.length ? playbook.tasks : snapshotTasks;

  // Build step status map from the selected execution for this playbook
  const isLiveExecution = executionForCanvas &&
    (visibleExecutionStatus === 'running' || visibleExecutionStatus === 'interrupted');

  const stepStatusMap = useMemo(() => {
    return buildCanvasStepStatusMap(executionTaskResults, canvasStatusTasks);
  }, [executionTaskResults, canvasStatusTasks]);

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
    for (const [taskId, judgeState] of buildCanvasJudgeStateMap(executionTaskResults)) {
      map.set(taskId, judgeState.judgeStatus);
    }
    return map;
  }, [executionTaskResults]);

  const stepJudgeResultMap = useMemo(() => {
    const map = new Map<string, PlaybookExecution['taskResults'][number]['judgeResult']>();
    for (const [taskId, judgeState] of buildCanvasJudgeStateMap(executionTaskResults)) {
      map.set(taskId, judgeState.judgeResult || null);
    }
    return map;
  }, [executionTaskResults]);

  // Map router node IDs to their most recent active decision label
  const activeRouterLabelMap = useMemo(() => {
    const decisions = executionForCanvas?.routerDecisions;
    if (!decisions || decisions.length === 0) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const d of decisions) {
      map.set(d.nodeId, d.label);
    }
    return map;
  }, [executionForCanvas?.routerDecisions]);

  const overviewResultNodeIds = useMemo(
    () => buildOverviewResultNodeIds(executionTaskResults),
    [executionTaskResults],
  );
  const overviewExecutableNodeIds = useMemo(
    () => new Set((playbook?.tasks ?? [])
      .filter((task) => canExecuteSingleStep(playbook, task))
      .map((task) => task.id)),
    [playbook],
  );

  // Overlay step statuses onto nodes.
  const mailTrigger = playbook?.triggers.find((tr) => tr.type === 'mail');

  const liveNodes = useMemo(() => {
    const selectedNodeIds = new Set(
      nodes.filter((node) => node.selected).map((node) => node.id),
    );
    const selectedNodeCount = selectedNodeIds.size;

    return nodes.map((node) => {
      if (node.id === TRIGGER_NODE_ID) {
        const nextSelected = resolveCanvasNodeSelection(selectedNodeIds, selectedNodeCount, node.id, selectedStepId);
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

      const currentData = node.data as PlaybookNodeData;
      const status = stepStatusMap.get(node.id);
      const semanticMatch = stepSemanticMatchMap.get(node.id);
      const judgeStatus = stepJudgeStatusMap.get(node.id);
      const judgeResult = stepJudgeResultMap.get(node.id);
      const routerLabel = activeRouterLabelMap.get(node.id);
      const nextSelected = resolveCanvasNodeSelection(selectedNodeIds, selectedNodeCount, node.id, selectedStepId);
      const nextData = {
        ...currentData,
        stepStatus: status,
        ...(semanticMatch !== undefined ? { stepSemanticMatch: semanticMatch } : {}),
        ...(judgeStatus !== undefined ? { stepJudgeStatus: judgeStatus } : {}),
        ...(judgeResult !== undefined ? { stepJudgeResult: judgeResult } : {}),
        ...(routerLabel !== undefined ? { activeRouterLabel: routerLabel } : {}),
      } as PlaybookNodeData;

      const dataChanged = currentData.stepStatus !== nextData.stepStatus
        || currentData.stepSemanticMatch !== nextData.stepSemanticMatch
        || (currentData as any).stepJudgeStatus !== (nextData as any).stepJudgeStatus
        || (currentData as any).stepJudgeResult !== (nextData as any).stepJudgeResult
        || currentData.activeRouterLabel !== nextData.activeRouterLabel;

      if (!dataChanged && node.selected === nextSelected) {
        return node;
      }

      return {
        ...node,
        selected: nextSelected,
        data: nextData,
      };
    });
  }, [nodes, selectedStepId, stepStatusMap, stepSemanticMatchMap, stepJudgeStatusMap, stepJudgeResultMap, activeRouterLabelMap, triggerNodeActions, playbook?.id, mailTrigger?.enabled]);

  const canvasNodes = useMemo(() => liveNodes.map((node) => ({
    ...node,
    data: {
      ...(node.data as PlaybookNodeData),
      isRecentlyChanged: recentlyChangedNodeIds.includes(node.id),
    },
  })), [liveNodes, recentlyChangedNodeIds]);

  // Style edges based on source node status
  const styledControlEdges = useMemo(() => {
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

  const liveEdges = useMemo(() => {
    if (!playbook || !dataBindingsVisible) {
      return styledControlEdges;
    }

    const visibleDataBindings = filterMirroredDataLayerEdges(
      dataBindingsToLayerEdges(playbook.dataBindings ?? [], playbook.tasks ?? []),
      styledControlEdges,
    );
    const dataLayerEdges: Edge[] = visibleDataBindings.map((edge) => ({
        id: `binding:${edge.id}`,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: 'dataBinding',
        selectable: false,
        focusable: false,
        deletable: false,
        animated: false,
        zIndex: 0,
        data: {
          layer: 'binding',
          label: edge.label,
          details: edge.details,
          status: edge.status,
          sourceKind: edge.kind,
        },
      }));

    return [...styledControlEdges, ...dataLayerEdges];
  }, [dataBindingsVisible, playbook, styledControlEdges]);
  useEffect(() => {
    setRuntimeContainerExpansion({});
  }, [executionForCanvas?.id]);
  const handleToggleRuntimeContainer = useCallback((containerId: string, expanded: boolean) => {
    setRuntimeContainerExpansion((current) => ({ ...current, [containerId]: expanded }));
  }, []);
  const runtimeGraphOptions = useMemo(() => ({
    expandedByContainerId: runtimeContainerExpansion,
    onToggleContainer: handleToggleRuntimeContainer,
  }), [handleToggleRuntimeContainer, runtimeContainerExpansion]);
  const executionRuntimeGraph = useExecutionFocusGraph(executionForCanvas, canvasNodes, liveEdges, runtimeGraphOptions);
  const renderedCanvasNodes = useMemo(
    () => executionViewMode === 'focus'
      ? executionRuntimeGraph.focusNodes
      : [...executionRuntimeGraph.inlineCanvasNodes, ...executionRuntimeGraph.inlineNodes],
    [executionRuntimeGraph.focusNodes, executionRuntimeGraph.inlineCanvasNodes, executionRuntimeGraph.inlineNodes, executionViewMode],
  );
  const renderedCanvasEdges = useMemo(
    () => executionViewMode === 'focus'
      ? executionRuntimeGraph.focusEdges
      : [...liveEdges, ...executionRuntimeGraph.inlineEdges],
    [executionRuntimeGraph.focusEdges, executionRuntimeGraph.inlineEdges, executionViewMode, liveEdges],
  );
  const runtimeViewportNodes = useMemo(() => {
    if (executionViewMode === 'focus') return executionRuntimeGraph.focusNodes;
    return [
      ...executionRuntimeGraph.inlineCanvasNodes.filter((node) => (
        typeof (node.data as Record<string, unknown>).dynamicReasoningRuntimeSourceHandleId === 'string'
      )),
      ...executionRuntimeGraph.inlineNodes,
    ];
  }, [executionRuntimeGraph.focusNodes, executionRuntimeGraph.inlineCanvasNodes, executionRuntimeGraph.inlineNodes, executionViewMode]);
  const runtimeViewportKey = useMemo(
    () => `${executionViewMode}:${designerSidebarWidth}:${runtimeViewportNodes.map((node) => (
      `${node.id}:${node.position.x}:${node.position.y}:${node.width ?? ''}:${node.height ?? ''}:${node.parentId ?? ''}`
    )).sort().join(',')}`,
    [designerSidebarWidth, executionViewMode, runtimeViewportNodes],
  );
  const runtimeViewportNodesRef = useRef(runtimeViewportNodes);
  runtimeViewportNodesRef.current = runtimeViewportNodes;
  const fittedRuntimeTopologyRef = useRef<string | null>(null);

  const fitCanvasNodes = useCallback((targetNodes: Array<{ id: string }>, duration = 300) => {
    const desktopDesignerWidth = window.matchMedia('(min-width: 640px)').matches
      ? designerSidebarWidth
      : 0;
    const canvasBounds = canvasChromeRef.current?.getBoundingClientRect();
    if (!desktopDesignerWidth || !canvasBounds) {
      return reactFlow.fitView({ nodes: targetNodes, padding: 0.2, duration });
    }

    const registeredNodes = targetNodes
      .map(({ id: nodeId }) => reactFlow.getNode(nodeId))
      .filter((node): node is Node => Boolean(node));
    if (registeredNodes.length === 0) return Promise.resolve(false);

    const graphBounds = reactFlow.getNodesBounds(registeredNodes);
    const viewportPadding = 48;
    const visibleWidth = Math.max(1, canvasBounds.width - desktopDesignerWidth - viewportPadding * 2);
    const visibleHeight = Math.max(1, canvasBounds.height - viewportPadding * 2);
    const zoom = Math.max(0.1, Math.min(
      1.5,
      visibleWidth / Math.max(graphBounds.width, 1),
      visibleHeight / Math.max(graphBounds.height, 1),
    ));

    return reactFlow.setCenter(
      graphBounds.x + graphBounds.width / 2 + desktopDesignerWidth / (2 * zoom),
      graphBounds.y + graphBounds.height / 2,
      { zoom, duration },
    );
  }, [designerSidebarWidth, reactFlow]);

  useEffect(() => {
    if (runtimeViewportNodes.length === 0) {
      fittedRuntimeTopologyRef.current = null;
      return;
    }
    if (fittedRuntimeTopologyRef.current === runtimeViewportKey) {
      return;
    }

    let retryTimer: number | undefined;
    let confirmationTimer: number | undefined;
    let retries = 0;
    const fitRuntimeGraph = () => {
      const nodes = runtimeViewportNodesRef.current;
      if (nodes.some((node) => !reactFlow.getNode(node.id)) && retries < 20) {
        retries += 1;
        retryTimer = window.setTimeout(fitRuntimeGraph, 50);
        return;
      }

      fittedRuntimeTopologyRef.current = runtimeViewportKey;
      const targetNodes = nodes.map(({ id }) => ({ id }));
      void fitCanvasNodes(targetNodes);
      confirmationTimer = window.setTimeout(() => {
        void fitCanvasNodes(targetNodes);
      }, 300);
    };
    retryTimer = window.setTimeout(fitRuntimeGraph, 100);
    return () => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (confirmationTimer !== undefined) window.clearTimeout(confirmationTimer);
    };
  }, [fitCanvasNodes, reactFlow, runtimeViewportKey, runtimeViewportNodes.length]);

  const handleOpenOverviewNode = useCallback((nodeId: string) => {
    selectStep(nodeId);
    setCanvasViewMode('expanded');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const node = reactFlow.getNode(nodeId);
        if (!node) return;
        const width = node.measured?.width ?? node.width ?? 260;
        const height = node.measured?.height ?? node.height ?? 160;
        void reactFlow.setCenter(
          node.position.x + width / 2,
          node.position.y + height / 2,
          { zoom: Math.max(reactFlow.getZoom(), 0.85), duration: 300 },
        );
      });
    });
  }, [reactFlow, selectStep]);

  const handleOpenOverviewExecution = useCallback((nodeId: string) => {
    setExecutionPanelCollapsed(false);
    openExecutionDetailTab('results', nodeId);
  }, [openExecutionDetailTab]);

  const {
    handleAddStep,
    handleAddRouterNode,
    handleAddHumanApprovalNode,
    handleAddStepFromTemplate,
    handleEditNode,
    handleCloneNode,
    handleConnectorDrop,
    handleConnectorDragStart,
    handleSkillDrop,
    handleSkillDragStart,
    handleBindingModalSave,
    handleCanvasDrop,
  } = usePlaybookCanvasNodeHandlers({
    playbook,
    nodes,
    reactFlowScreenToFlowPosition: reactFlow.screenToFlowPosition,
    addNode,
    setEditingTask,
    setEditorOpen,
    setBindingModalState,
    addToolBindingToTask,
    addSkillBindingToTask,
    routerNodeDefaultTitle: t('routerNode.defaultTitle'),
    humanApprovalNodeDefaultTitle: t('humanApprovalNode.defaultTitle'),
    showWarning,
    warnings: {
      dropSkillOnTask: t('skills.dropOnTaskWarning'),
    },
  });

  const handleExecuteStep = useCallback(
    async (nodeId: string) => {
      if (!id) return;
      if (isDirty) await saveNow();
      const node = nodes.find((n) => n.id === nodeId);
      const task = node?.data as unknown as PlaybookTask | undefined;
      try {
        if (!canExecuteSingleStep(playbook, task ?? null)) {
          showError(t('errors.executionActionUnavailable'));
          return;
        }

        await executePlaybook(id, {
          singleStepTaskId: nodeId,
          executionMode: 'inherit',
          stepExecutionModes: { [nodeId]: task?.stepReplayMode || 'live' },
          streaming: true,
          runNodeReflection: nodeReflectionEnabled,
          advisorAutopilotEnabled,
        });
      } catch {
        // handled in store
      }
    },
    [id, isDirty, saveNow, executePlaybook, nodes, advisorAutopilotEnabled, nodeReflectionEnabled, playbook, t],
  );

  const handleRerunAfterOptimization = useCallback(async () => {
    setPendingRerunTaskId(null);
    showError(t('errors.executionActionUnavailable'));
  }, [
    setPendingRerunTaskId,
    t,
  ]);

  useEffect(() => {
    if (!pendingRerunTaskId) return;
    showError(t('errors.executionActionUnavailable'));
    setPendingRerunTaskId(null);
  }, [pendingRerunTaskId, setPendingRerunTaskId, t]);

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

  const handleReferenceModeChoice = useCallback(
    (mode: StepReplayMode) => {
      if (!playbook || !referenceModePrompt) return;
      updateTasks(playbook.tasks.map((task) => (
        task.id === referenceModePrompt.taskId ? { ...task, stepReplayMode: mode } : task
      )));
      setReferenceModePrompt(null);
    },
    [playbook, referenceModePrompt, updateTasks],
  );

  const executionForNodeActions =
    currentExecution?.playbookId === id
      ? currentExecution
      : execution || null;

  const getTaskResultForNode = useCallback(
    (nodeId: string) => executionForNodeActions?.taskResults.find((tr) => tr.taskId === nodeId) || null,
    [executionForNodeActions],
  );

  const handleBaselineSaved = useCallback(
    (nodeId: string) => {
      const task = playbook?.tasks.find((candidate) => candidate.id === nodeId);
      setReferenceModePrompt({
        taskId: nodeId,
        taskTitle: task?.title || getTaskResultForNode(nodeId)?.nodeTitle || nodeId,
      });
    },
    [getTaskResultForNode, playbook?.tasks],
  );

  const {
    openOutputFormatEditor,
    closeOutputFormatDialog,
    handleSaveOutputFormat,
    handleRemoveOutputFormat,
    saveAndCloseOutputFormatDialog,
    canSaveBaseline,
    canGenerateEditingOutputFormat,
    handleSaveBaseline,
    handleGenerateOutputFormat,
  } = usePlaybookCanvasOutputFormatHandlers({
    id,
    editingOutputFormatTaskId,
    setEditingOutputFormatTaskId,
    setEditingOutputFormatVersion,
    setOutputFormatDraft,
    setOutputFormatLoading,
    setOutputFormatSaving,
    setOutputFormatGenerating,
    fetchOutputFormatTemplate,
    updateOutputFormatTemplate,
    deleteOutputFormatTemplate,
    grabOutputFormatTemplate,
    outputFormatDraft,
    executionForNodeActions,
    getTaskResultForNode,
    onBaselineSaved: handleBaselineSaved,
    validateTaskReplay,
  });

  const handlePaneClick = useCallback(() => {
    if (editingOutputFormatTaskId) {
      saveAndCloseOutputFormatDialog();
    }
    if (editorOpen) {
      nodeEditorRef.current?.flushSave();
      setEditorOpen(false);
    }
  }, [editingOutputFormatTaskId, editorOpen, saveAndCloseOutputFormatDialog, setEditorOpen]);

  const canSkipStep = useCallback(
    (_nodeId: string) => false,
    [],
  );

  const canResumeFromStep = useCallback(
    (nodeId: string) => {
      if (!currentExecution || currentExecution.playbookId !== id || !currentExecution.waitingForHumanInput) {
        return false;
      }
      if (currentExecution.currentInterruptTaskId !== nodeId) {
        return false;
      }
      const interrupt = currentExecution.interruptPayload;
      if (!interrupt || interrupt.taskId !== nodeId) {
        return false;
      }
      const resumableActions = interrupt.resumableActions || [];
      const isApprovalLike = interrupt.type === 'approval_request' || interrupt.type === 'human_approval';
      return resumableActions.includes('approve') || (resumableActions.length === 0 && isApprovalLike);
    },
    [currentExecution, id],
  );

  const canRunFromStep = useCallback(
    (nodeId: string) => {
      if (!currentExecution || currentExecution.playbookId !== id) return false;
      if (currentExecution.status !== 'completed') return false;
      if (hasActiveExecution) return false;
      const taskResult = currentExecution.taskResults.find(
        (tr) => tr.taskId === nodeId && tr.status === 'completed',
      );
      if (!taskResult) return false;
      const node = playbook?.tasks.find((t) => t.id === nodeId);
      if (!node) return false;
      if ((node as any).containerConfig?.parentIteratorId) return false;
      return true;
    },
    [currentExecution, id, hasActiveExecution, playbook],
  );

  const handleRunFromStep = useCallback((nodeId: string) => {
    if (!currentExecution || currentExecution.playbookId !== id) return;
    void runFromStep(id, currentExecution.id, nodeId);
  }, [currentExecution, id, runFromStep]);

  const handleResumeFromStep = useCallback((nodeId: string) => {
    if (!currentExecution || currentExecution.playbookId !== id) {
      return;
    }
    const interruptedTask = currentExecution.taskResults.find(
      (taskResult) => taskResult.taskId === nodeId && taskResult.status === 'interrupted',
    );
    void resumeFromStep(id, currentExecution.id, nodeId, {
      action: 'approve',
      interruptId: currentExecution.interruptPayload?.interruptId || undefined,
      iteration: interruptedTask?.iteration,
    });
  }, [currentExecution, id, resumeFromStep]);

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

  const handleOpenNodeAdvisor = useCallback(async (taskId: string) => {
    if (!playbook?.id) return;

    const task = playbook.tasks.find((item) => item.id === taskId);
    if (!task) return;

    setNodeAdvisorTaskId(taskId);
    setNodeAdvisorSuggestions([]);
    setNodeAdvisorOpen(true);
    setNodeAdvisorLoading(true);

    try {
      const response = await requestPlaybookNodeAdvisor(playbook.id, taskId, {
        title: task.title,
        description: task.description,
      });
      setNodeAdvisorSuggestions(response.suggestions || []);
    } catch (error) {
      setNodeAdvisorSuggestions([]);
      showError(error instanceof Error ? error.message : 'Failed to load node advisor suggestions.');
    } finally {
      setNodeAdvisorLoading(false);
    }
  }, [playbook]);

  const handleApplyNodeAdvisorSuggestion = useCallback((suggestion: PlaybookNodeAdvisorSuggestion) => {
    if (!playbook || !nodeAdvisorTaskId || !suggestion.patch) return;
    const patch = suggestion.patch;

    const nextTasks = playbook.tasks.map((task) => {
      if (task.id !== nodeAdvisorTaskId) return task;
      return {
        ...task,
        title: patch.taskTitle ?? task.title,
        description: patch.taskDescription ?? task.description,
        assignedAgentId: patch.assignedAgentId ?? task.assignedAgentId,
      };
    });

    void updatePlaybook(playbook.id, { tasks: nextTasks });
    setNodeAdvisorOpen(false);
  }, [nodeAdvisorTaskId, playbook, updatePlaybook]);

  const nodeContextMenuActions = useMemo<NodeContextMenuActions>(
    () => ({
      onEdit: handleEditNode,
      onAdvise: (nodeId) => { void handleOpenNodeAdvisor(nodeId); },
      onClone: handleCloneNode,
      onDelete: removeNode,
      onToggleEnabled: handleToggleEnabled,
      onExecuteStep: handleExecuteStep,
      onResumeFromStep: handleResumeFromStep,
      onRunFromStep: handleRunFromStep,
      onSkipStep: () => undefined,
      onSaveBaseline: handleSaveBaseline,
      canExecute: !hasActiveExecution && !isSaving && !isDirty,
      isExecuting,
      canResumeFromStep,
      canRunFromStep,
      canSkipStep,
      canSaveBaseline,
      onCopySelection: () => { void copySelection(); },
      onCutSelection: () => { void cutSelection(); },
      onPasteClipboard: () => { void pasteClipboard(); },
      hasSelection: nodes.some((n) => n.selected && n.id !== '__trigger__'),
    }),
    [
      handleEditNode,
      handleOpenNodeAdvisor,
      handleCloneNode,
      removeNode,
      handleToggleEnabled,
      handleExecuteStep,
      handleResumeFromStep,
      handleRunFromStep,
      handleSaveBaseline,
      hasActiveExecution,
      isSaving,
      isDirty,
      isExecuting,
      canResumeFromStep,
      canRunFromStep,
      canSkipStep,
      canSaveBaseline,
      copySelection,
      cutSelection,
      pasteClipboard,
      nodes,
    ],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: any) => {
      if (node.type === 'playbookRuntimeStep') {
        return;
      }
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

  const handleResizeIteratorNode = useCallback(
    (taskId: string, size: { width: number; height: number }) => {
      updateNodeData(taskId, {
        iteratorLayout: {
          width: Math.round(size.width),
          height: Math.round(size.height),
        },
      });
    },
    [updateNodeData],
  );

  const handleRepackIteratorChildren = useCallback(
    (taskId: string) => {
      repackIteratorChildren(taskId);
    },
    [repackIteratorChildren],
  );

  const createProgrammaticEdge = useCallback((sourceId: string, targetId: string, sourceOutputPortId = 'default', targetInputPortId = 'default', options?: { kind?: 'sequential' | 'conditional'; routerLabel?: string | null; priority?: number | null }): Edge => ({
    id: `e-${sourceId}-${sourceOutputPortId}-${targetId}-${targetInputPortId}${options?.routerLabel ? `-${options.routerLabel}` : ''}`,
    source: sourceId,
    target: targetId,
    sourceHandle: sourceOutputPortId,
    targetHandle: targetInputPortId,
    type: options?.kind === 'conditional' || options?.routerLabel ? 'conditional' : 'animated',
    animated: !(options?.kind === 'conditional' || options?.routerLabel),
    data: {
      kind: options?.kind ?? 'sequential',
      routerLabel: options?.routerLabel ?? null,
      priority: options?.priority ?? null,
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

  const focusConstructionNode = useCallback((layoutedTasks: PlaybookTask[], nodeId: string) => {
    const task = layoutedTasks.find((candidate) => candidate.id === nodeId);
    if (!task) return;

    void reactFlow.setCenter(task.positionX + 140 + (designerSidebarWidth / 2), task.positionY + 90, {
      zoom: 1.08,
      duration: 650,
    });
    scheduleChangeFeedbackCleanup();
  }, [designerSidebarWidth, reactFlow, scheduleChangeFeedbackCleanup]);

  const handleValidationIssueSelect = useCallback((issue: PlaybookValidationIssue) => {
    if (!playbook?.tasks.some((task) => task.id === issue.taskId)) return;
    setNodes((currentNodes) => currentNodes.map((node) => ({
      ...node,
      selected: node.id === issue.taskId,
    })));
    selectStep(issue.taskId);
    const fitIssueNode = () => {
      void reactFlow.fitView({
        nodes: [{ id: issue.taskId }],
        padding: 0.35,
        duration: 650,
        maxZoom: 1.08,
      });
    };
    if (window.matchMedia('(max-width: 1023px)').matches) {
      setExecutionPanelCollapsed(true);
      setExecutionPanelOpen(false);
      setDesignerOpen(false);
      window.requestAnimationFrame(() => window.requestAnimationFrame(fitIssueNode));
      return;
    }
    if (designerSidebarWidth > 0 && window.matchMedia('(min-width: 640px)').matches) {
      focusConstructionNode(playbook.tasks, issue.taskId);
      return;
    }
    fitIssueNode();
  }, [designerSidebarWidth, focusConstructionNode, playbook, reactFlow, selectStep, setDesignerOpen, setExecutionPanelCollapsed, setExecutionPanelOpen, setNodes]);

  const handleApplyIntentSuggestion = useCallback((
    suggestion: PlaybookIntentSuggestion,
    options?: { replaceAll?: boolean; expectedDefinitionRevision?: number; save?: boolean; clearSuggestions?: boolean; focus?: boolean; applicationKey?: string; focusMode?: 'changed-area' | 'construction-frontier'; connectAnchors?: boolean; captureHistory?: boolean; confirmDeletes?: boolean },
  ) => {
    if (!playbook) return;
    const shouldSave = options?.save ?? true;
    const shouldClearSuggestions = options?.clearSuggestions ?? true;
    const shouldFocus = options?.focus ?? true;
    const shouldConnectAnchors = options?.connectAnchors ?? true;
    const shouldCaptureHistory = options?.captureHistory ?? true;
    const shouldConfirmDeletes = options?.confirmDeletes ?? true;
    const focusMode = options?.focusMode ?? 'changed-area';
    const suggestionApplicationKey = options?.applicationKey ?? createIntentSuggestionApplicationKey(playbook.id, suggestion);
    const latestPlaybook = usePlaybookStore.getState().currentPlaybook;
    const graphPlaybook = latestPlaybook?.id === playbook.id ? latestPlaybook : playbook;
    const suggestionBaseDefinitionRevision = options?.expectedDefinitionRevision ?? graphPlaybook.definitionRevision;
    const graphEdges = latestPlaybook?.id === playbook.id
      ? playbookEdgesToFlowEdges(graphPlaybook.edges, graphPlaybook.tasks)
      : edges;

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
    const normalizeIntentInputPorts = (ports: PlaybookIntentTaskDraft['inputPorts']) => {
      if (!ports || ports.length === 0) {
        return [];
      }

      return ports.map((port) => ({
        id: port.id,
        name: port.name || port.id,
        artifactKind: port.artifactKind,
        required: port.required === true,
      }));
    };
    const normalizeIntentOutputPorts = (ports: PlaybookIntentTaskDraft['outputPorts']) => {
      if (!ports || ports.length === 0) {
        return [];
      }

      return ports.map((port) => ({
        id: port.id,
        name: port.name || port.id,
        artifactKind: port.artifactKind,
      }));
    };
    const mergePorts = <T extends { id: string; name: string }>(existing: T[] | undefined, updates: Array<{ id: string; name?: string | null; [k: string]: unknown }>): T[] | undefined => {
      if (!updates || updates.length === 0) return existing;
      const map = new Map<string, T>((existing || []).map((p) => [p.id, { ...p }]));
      for (const u of updates) {
        const entry = map.get(u.id);
        if (entry) {
          if (u.name) entry.name = u.name;
        } else {
          map.set(u.id, { ...u, id: u.id, name: u.name || u.id } as unknown as T);
        }
      }
      return [...map.values()];
    };
    const replacePorts = (updates: Array<{ id: string; name?: string | null; artifactKind: unknown; required?: boolean }>): TaskInputPort[] => {
      return updates.map((u) => ({ id: u.id, name: u.name || u.id, artifactKind: u.artifactKind as import('../types').ArtifactKind, required: u.required === true }));
    };
    const replaceOutputPorts = (updates: Array<{ id: string; name?: string | null; artifactKind: unknown }>): TaskOutputPort[] => {
      return updates.map((u) => ({ id: u.id, name: u.name || u.id, artifactKind: u.artifactKind as import('../types').ArtifactKind }));
    };
    const applyUpdateNodePorts = (taskId: string, task: PlaybookTask, intentTask: Partial<PlaybookIntentTaskDraft>) => {
      const updatedTask: PlaybookTask = {
        ...task,
        ...(intentTask.title ? { title: intentTask.title } : {}),
        ...(intentTask.description ? { description: intentTask.description } : {}),
        assignedAgentId: intentTask.agentSlug ? resolveAssignedAgentId(intentTask.agentSlug) : task.assignedAgentId,
      };
      const newInputPortIds = new Set<string>();
      const newOutputPortIds = new Set<string>();
      if (intentTask.inputPorts && intentTask.inputPorts.length > 0) {
        updatedTask.inputPorts = replacePorts(normalizeIntentInputPorts(intentTask.inputPorts));
        updatedTask.inputPorts.forEach((p) => newInputPortIds.add(p.id));
      }
      if (intentTask.outputPorts && intentTask.outputPorts.length > 0) {
        updatedTask.outputPorts = replaceOutputPorts(normalizeIntentOutputPorts(intentTask.outputPorts));
        updatedTask.outputPorts.forEach((p) => newOutputPortIds.add(p.id));
      }
      if (newInputPortIds.size > 0 || newOutputPortIds.size > 0) {
        nextDataBindings = nextDataBindings.filter((b) => {
          if (b.targetNode !== taskId) return true;
          if (newInputPortIds.size > 0 && !newInputPortIds.has(b.targetPort)) return false;
          return true;
        });
      }
      return updatedTask;
    };

    const findMatchingTemplate = (_title: string, _description: string, nodeTemplateKey?: string | null) => {
      if (nodeTemplateKey) {
        const exactTemplate = nodeTemplates.find((template) => template.key === nodeTemplateKey);
        if (exactTemplate) {
          return exactTemplate;
        }
        console.warn(`playbook_intent_template_key_unresolved key=${nodeTemplateKey}`);
      }

      return null;
    };


    const createIntentTask = (
      taskId: string,
      title: string,
      description: string,
      agentSlug: string | null | undefined,
      nodeTemplateKey: string | null | undefined,
      explicitNodeType: PlaybookIntentTaskDraft['nodeType'] | undefined,
      explicitTaskType: PlaybookIntentTaskDraft['taskType'] | undefined,
      inputPorts: PlaybookIntentTaskDraft['inputPorts'] | undefined,
      outputPorts: PlaybookIntentTaskDraft['outputPorts'] | undefined,
      iteratorBody: PlaybookIntentTaskDraft['iteratorBody'] | undefined,
      routerConfig: PlaybookIntentTaskDraft['routerConfig'] | undefined,
      humanApprovalConfig: PlaybookIntentTaskDraft['humanApprovalConfig'] | undefined,
      retryPolicy: PlaybookIntentTaskDraft['retryPolicy'] | undefined,
      modelId: string | null | undefined,
      anchorTask: PlaybookTask | null,
      order: number,
      toolBindings?: PlaybookIntentTaskDraft['toolBindings'],
      skillBindings?: PlaybookIntentTaskDraft['skillBindings'],
    ): PlaybookTask => {
      const matchedTemplate = findMatchingTemplate(title, description, nodeTemplateKey);
      const matchedNodeType = matchedTemplate?.nodeType ?? null;
      const genericInputPorts = normalizeIntentInputPorts(inputPorts);
      const genericOutputPorts = normalizeIntentOutputPorts(outputPorts);

      const isIterator = isIntentIteratorTask(matchedTemplate, iteratorBody);
      const semantics = resolveIntentNodeSemantics(
        explicitNodeType,
        explicitTaskType,
        matchedNodeType,
        isIterator,
        Boolean(routerConfig),
        Boolean(humanApprovalConfig),
      );

      return {
        id: taskId,
        title,
        description,
        assignedAgentId: matchedTemplate?.nodeType === 'agent'
          ? (matchedTemplate.assignedAgentId ?? resolveAssignedAgentId(agentSlug))
          : resolveAssignedAgentId(agentSlug),
        executionMode: matchedTemplate?.nodeType === 'action' ? 'action' : 'agent',
        selectedAction: matchedTemplate?.nodeType === 'action' ? (matchedTemplate.selectedAction ?? undefined) : undefined,
        executionOrder: order,
        positionX: (anchorTask?.positionX || 0) + DEFAULT_NODE_SPACING_X,
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
        taskType: semantics.taskType,
        nodeType: semantics.nodeType,
        nodeTemplateKey: nodeTemplateKey ?? matchedTemplate?.key ?? null,
        routerConfig: routerConfig ?? matchedTemplate?.routerConfig ?? null,
        humanApprovalConfig: humanApprovalConfig ?? matchedTemplate?.humanApprovalConfig ?? null,
        iteratorConfig: semantics.nodeType === 'iterator'
          ? matchedTemplate?.iteratorConfig
            ? { ...matchedTemplate.iteratorConfig }
            : {
                source: '{{items}}',
                mode: 'item',
                batchSize: 10,
                itemVariable: 'item',
                outputVariable: 'processed_items',
                errorStrategy: 'stop',
              }
          : undefined,
        inputPorts: genericInputPorts.length > 0
          ? genericInputPorts
          : matchedTemplate
            ? clonePortSet(matchedTemplate.inputPorts, [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }])
            : semantics.nodeType === 'iterator'
            ? getDefaultIteratorInputPorts()
            : clonePortSet(anchorTask?.inputPorts, [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }]),
        outputPorts: genericOutputPorts.length > 0
          ? genericOutputPorts
          : matchedTemplate
            ? clonePortSet(matchedTemplate.outputPorts, [{ id: 'default', name: 'Output', artifactKind: 'text' }])
            : semantics.nodeType === 'iterator'
            ? getDefaultIteratorOutputPorts()
            : clonePortSet(anchorTask?.outputPorts, [{ id: 'default', name: 'Output', artifactKind: 'text' }]),
        retryPolicy: retryPolicy ?? (matchedTemplate?.retryPolicy ? { ...matchedTemplate.retryPolicy } : null),
        modelId: modelId ?? matchedTemplate?.modelId ?? null,
        toolBindings,
        skillBindings,
      };
    };

    const changedNodeIds = new Set<string>();
    const changedEdgeIds = new Set<string>();
    const newlyCreatedNodeIds: string[] = [];

    const markEdgeChanged = (edge: Edge) => {
      changedEdgeIds.add(edge.id);
      return edge;
    };

    const commitGraph = (nextTasks: PlaybookTask[], nextEdges: Edge[], nextDataBindings: DataBinding[]) => {
      const layoutedTasks = autoLayoutTasks(nextTasks, flowEdgesToPlaybookEdges(nextEdges));
      if (shouldCaptureHistory) captureSnapshot();
      setNodes(tasksToNodes(layoutedTasks));
      setEdges(nextEdges);
      updateTasks(layoutedTasks);
      updateEdges(flowEdgesToPlaybookEdges(nextEdges));
      updateDataBindings(nextDataBindings);
      setIntentSuggestions([]);
      const changedIds = layoutedTasks.filter((task) => changedNodeIds.has(task.id)).map((task) => task.id);
      setRecentlyChangedNodeIds(changedIds);
      setRecentlyChangedEdgeIds(Array.from(changedEdgeIds));
      if (shouldFocus) {
        if (focusMode === 'construction-frontier') {
          const frontierNodeId = newlyCreatedNodeIds[newlyCreatedNodeIds.length - 1];
          if (frontierNodeId) {
            focusConstructionNode(layoutedTasks, frontierNodeId);
          }
        } else {
          focusChangedArea(layoutedTasks, changedIds, deletedBounds);
        }
      }
    };

    const selectedTask = selectedStepId
      ? graphPlaybook.tasks.find((task) => task.id === selectedStepId) || null
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

    if (shouldConfirmDeletes && suggestion.kind === 'workflow_plan' && suggestion.impact.nodesToDelete > 0 && !window.confirm(t('intentBar.confirmDeletePlan'))) {
      return;
    }

    let nextTasks = options?.replaceAll ? [] : [...graphPlaybook.tasks];
    let nextEdges = options?.replaceAll ? [] : [...graphEdges];
    let nextDataBindings = options?.replaceAll ? [] : [...(graphPlaybook.dataBindings ?? [])];
    const createdNodeRefs = new Map<string, string>();
    let deletedBounds: { x: number; y: number; width: number; height: number } | null = null;
    const applicationWarnings: string[] = [];

    const resolveTaskReference = (reference: string | null | undefined) => {
      if (!reference) return null;
      const mapped = createdNodeRefs.get(reference);
      if (mapped !== undefined) {
        if (mapped === '') {
          applicationWarnings.push(`Skipped reference to unresolved anchor nodeRef="${reference}"`);
          return null;
        }
        return mapped;
      }
      if (nextTasks.some((task) => task.id === reference)) {
        return reference;
      }
      return null;
    };

    const resolveScopedTaskReference = (taskId: string | null | undefined, nodeRef: string | null | undefined, iteratorNodeRef?: string | null) => {
      if (taskId) return resolveTaskReference(taskId);
      if (iteratorNodeRef && nodeRef) return resolveTaskReference(`${iteratorNodeRef}.${nodeRef}`);
      return resolveTaskReference(nodeRef);
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
      logicalNodeKey: string,
      taskTitle: string,
      taskDescription: string,
      agentSlug: string | null | undefined,
      nodeTemplateKey: string | null | undefined,
      inputPorts: PlaybookIntentTaskDraft['inputPorts'] | undefined,
      outputPorts: PlaybookIntentTaskDraft['outputPorts'] | undefined,
      nodeType: PlaybookIntentTaskDraft['nodeType'] | undefined,
      taskType: PlaybookIntentTaskDraft['taskType'] | undefined,
      iteratorBody: PlaybookIntentTaskDraft['iteratorBody'] | undefined,
      routerConfig: PlaybookIntentTaskDraft['routerConfig'] | undefined,
      humanApprovalConfig: PlaybookIntentTaskDraft['humanApprovalConfig'] | undefined,
      retryPolicy: PlaybookIntentTaskDraft['retryPolicy'] | undefined,
      modelId: string | null | undefined,
      mode: 'append' | 'before' | 'after' | 'as_input',
      targetTaskId: string | null,
      nodeRef: string | null,
      newNodeRef: string | null,
      targetTaskIds?: string[],
      nodeRefs?: string[],
      anchorSourceOutputPortId?: string | null,
      anchorTargetInputPortId?: string | null,
      toolBindings?: PlaybookIntentTaskDraft['toolBindings'],
      skillBindings?: PlaybookIntentTaskDraft['skillBindings'],
    ) => {
      const hasExplicitAnchors = Boolean(targetTaskId || nodeRef || (targetTaskIds || []).length || (nodeRefs || []).length);
      const anchorTaskIds = resolveAnchorTaskIds(targetTaskId, nodeRef, targetTaskIds, nodeRefs);
      const anchorTasks = anchorTaskIds.map((id) => nextTasks.find((task) => task.id === id)).filter((task): task is PlaybookTask => Boolean(task));
      const anchorTask = hasExplicitAnchors ? (anchorTasks[0] || null) : null;
      const deterministicNodeId = createIntentSuggestionNodeId(suggestionApplicationKey, logicalNodeKey);
      const existingTask = nextTasks.find((task) => task.id === deterministicNodeId) || null;
      if (existingTask) {
        if (newNodeRef) {
          createdNodeRefs.set(newNodeRef, existingTask.id);
        }
        return true;
      }

      if (hasExplicitAnchors && anchorTasks.length === 0) {
        if (newNodeRef) {
          createdNodeRefs.set(newNodeRef, '');
        }
        return false;
      }

      const newTask = createIntentTask(
        deterministicNodeId,
        taskTitle,
        taskDescription,
        agentSlug,
        nodeTemplateKey,
        nodeType,
        taskType,
        inputPorts,
        outputPorts,
        iteratorBody,
        routerConfig,
        humanApprovalConfig,
        retryPolicy,
        modelId,
        anchorTask,
        nextTasks.length,
        toolBindings,
        skillBindings,
      );
      nextTasks = [...nextTasks, newTask];
      changedNodeIds.add(newTask.id);
      newlyCreatedNodeIds.push(newTask.id);
      if (newNodeRef) {
        createdNodeRefs.set(newNodeRef, newTask.id);
      }

      if (newTask.taskType === 'iterator' && iteratorBody?.steps.length) {
        const iteratorChildRefs = new Map<string, string>();

        iteratorBody.steps.forEach((step: NonNullable<PlaybookIntentTaskDraft['iteratorBody']>['steps'][number], index: number) => {
          const childTask = createIntentTask(
            createIntentSuggestionNodeId(suggestionApplicationKey, `${logicalNodeKey}:iterator:${step.nodeRef}`),
            step.title,
            step.description,
            step.agentSlug,
            step.nodeTemplateKey,
            step.nodeType,
            step.taskType,
            step.inputPorts,
            step.outputPorts,
            undefined,
            step.routerConfig,
            step.humanApprovalConfig,
            step.retryPolicy,
            step.modelId,
            newTask,
            nextTasks.length + index + 1,
            step.toolBindings,
            step.skillBindings,
          );
          const childPosition = getIteratorBodyChildPosition(newTask.positionX, newTask.positionY, index, iteratorBody.steps.length);
          childTask.positionX = childPosition.x;
          childTask.positionY = childPosition.y;
          if (!nextTasks.some((task) => task.id === childTask.id)) {
            childTask.containerConfig = { parentIteratorId: newTask.id };
            nextTasks = [...nextTasks, childTask];
            changedNodeIds.add(childTask.id);
            newlyCreatedNodeIds.push(childTask.id);
          }
          if (newNodeRef) {
            createdNodeRefs.set(`${newNodeRef}.${step.nodeRef}`, childTask.id);
          }
          iteratorChildRefs.set(step.nodeRef, childTask.id);
        });

        nextTasks = nextTasks.map((task) => task.containerConfig?.parentIteratorId === newTask.id
          ? remapRouterConditionSourceNodes(task, iteratorChildRefs)
          : task);

        const seenChildEdgePairs = new Set<string>();

        iteratorBody.edges.forEach((edge: NonNullable<PlaybookIntentTaskDraft['iteratorBody']>['edges'][number]) => {
          const sourceId = iteratorChildRefs.get(edge.sourceNodeRef);
          const targetId = iteratorChildRefs.get(edge.targetNodeRef);
          if (!sourceId || !targetId || sourceId === targetId) {
            return;
          }

          const pairKey = `${sourceId}:${targetId}`;
          if (seenChildEdgePairs.has(pairKey)) {
            return;
          }
          seenChildEdgePairs.add(pairKey);

          if (nextEdges.some((e) => e.source === sourceId && e.target === targetId)) {
            return;
          }

          const sourceTask = nextTasks.find((task) => task.id === sourceId);
          const targetTask = nextTasks.find((task) => task.id === targetId);
          if (!sourceTask || !targetTask) {
            return;
          }

          const resolvedPorts = resolveIntentEdgePorts(
            sourceTask,
            targetTask,
            edge.sourceOutputPortId || edge.routerLabel,
            edge.targetInputPortId,
          );
          if (!resolvedPorts) {
            return;
          }

          appendIntentEdge(
            sourceId,
            targetId,
            resolvedPorts.sourceOutputPortId,
            resolvedPorts.targetInputPortId,
            buildIntentEdgeOptions(edge.edgeKind, edge.routerLabel, edge.priority),
          );
        });
      }

      if (!anchorTask || !shouldConnectAnchors) {
        return true;
      }

        if (anchorTasks.length > 1) {
          anchorTasks.forEach((task, index) => {
            const resolvedPorts = resolveIntentEdgePorts(task, newTask, anchorSourceOutputPortId, anchorTargetInputPortId)
              || { sourceOutputPortId: getPreferredIntentOutputPortId(task), targetInputPortId: getPreferredIntentInputPortId(newTask, index) };
            appendIntentEdge(task.id, newTask.id, resolvedPorts.sourceOutputPortId, resolvedPorts.targetInputPortId);
          });
          return true;
        }

        if (mode === 'as_input') {
          const resolvedPorts = resolveIntentEdgePorts(newTask, anchorTask, anchorSourceOutputPortId, anchorTargetInputPortId)
            || { sourceOutputPortId: getPreferredIntentOutputPortId(newTask), targetInputPortId: getPreferredIntentInputPortId(anchorTask) };
          appendIntentEdge(newTask.id, anchorTask.id, resolvedPorts.sourceOutputPortId, resolvedPorts.targetInputPortId);
          return true;
        }

      if (mode === 'before') {
        const incomingEdges = nextEdges.filter((edge) => edge.target === anchorTask.id);
        const untouchedEdges = nextEdges.filter((edge) => edge.target !== anchorTask.id);
        nextEdges = untouchedEdges;
        incomingEdges.forEach((edge) => {
          const data = (edge.data || {}) as { sourceOutputPortId?: string };
          const edgeTargetInputPortId = ((edge.data || {}) as { targetInputPortId?: string }).targetInputPortId || edge.targetHandle || 'default';
          const rewrittenTargetInputPortId = newTask.inputPorts?.some((port) => port.id === edgeTargetInputPortId)
            ? edgeTargetInputPortId
            : getPreferredIntentInputPortId(newTask);
          appendIntentEdge(
            edge.source,
            newTask.id,
            data.sourceOutputPortId || edge.sourceHandle || 'default',
            rewrittenTargetInputPortId,
          );
        });
        appendIntentEdge(newTask.id, anchorTask.id, getPreferredIntentOutputPortId(newTask), getPreferredIntentInputPortId(anchorTask));
          return true;
        }

        if (mode === 'after') {
          const outgoingEdges = nextEdges.filter((edge) => edge.source === anchorTask.id);
          const untouchedEdges = nextEdges.filter((edge) => edge.source !== anchorTask.id);
          nextEdges = untouchedEdges;
          const resolvedPorts = resolveIntentEdgePorts(anchorTask, newTask, anchorSourceOutputPortId, anchorTargetInputPortId)
            || { sourceOutputPortId: getPreferredIntentOutputPortId(anchorTask), targetInputPortId: getPreferredIntentInputPortId(newTask) };
          appendIntentEdge(anchorTask.id, newTask.id, resolvedPorts.sourceOutputPortId, resolvedPorts.targetInputPortId);
          outgoingEdges.forEach((edge) => {
            const data = (edge.data || {}) as { targetInputPortId?: string };
            appendIntentEdge(
              newTask.id,
              edge.target,
              getPreferredIntentOutputPortId(newTask),
              data.targetInputPortId || edge.targetHandle || 'default',
            );
          });
          return true;
        }

        {
          const resolvedPorts = resolveIntentEdgePorts(anchorTask, newTask, anchorSourceOutputPortId, anchorTargetInputPortId)
            || { sourceOutputPortId: getPreferredIntentOutputPortId(anchorTask), targetInputPortId: getPreferredIntentInputPortId(newTask) };
          appendIntentEdge(anchorTask.id, newTask.id, resolvedPorts.sourceOutputPortId, resolvedPorts.targetInputPortId);
        }
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
      nextTasks = nextTasks.filter((task) => task.id !== taskId);
      nextEdges = untouchedEdges;
      nextDataBindings = nextDataBindings.filter(
        (b) => b.targetNode !== taskId && b.sourceNode !== taskId,
      );

      const existingEdgeIds = new Set(nextEdges.map((edge) => edge.id));
      incomingEdges.forEach((incomingEdge) => {
        const incomingData = (incomingEdge.data || {}) as { sourceOutputPortId?: string };
        const sourceOutputPortId = incomingData.sourceOutputPortId || incomingEdge.sourceHandle || 'default';

        outgoingEdges.forEach((outgoingEdge) => {
          if (incomingEdge.source === outgoingEdge.target) {
            return;
          }

          const outgoingData = (outgoingEdge.data || {}) as { targetInputPortId?: string };
          const targetInputPortId = outgoingData.targetInputPortId || outgoingEdge.targetHandle || 'default';
          const bridgedEdge = createProgrammaticEdge(
            incomingEdge.source,
            outgoingEdge.target,
            sourceOutputPortId,
            targetInputPortId,
          );
          if (existingEdgeIds.has(bridgedEdge.id)) {
            return;
          }

          existingEdgeIds.add(bridgedEdge.id);
          appendIntentEdge(
            incomingEdge.source,
            outgoingEdge.target,
            sourceOutputPortId,
            targetInputPortId,
          );
        });
      });
    };

    const mirrorNodeOutputBindingEdge = (
      resolvedTargetId: string,
      targetPort: string,
      resolvedSourceId: string,
      sourcePort: string,
    ) => {
      nextEdges = nextEdges.filter((edge) => {
        const edgeData = (edge.data || {}) as { sourceOutputPortId?: string; targetInputPortId?: string; routerLabel?: string | null };
        const isConditionalEdge = edge.type === 'conditional' || Boolean(edgeData.routerLabel);
        const matchesTargetPort = edge.target === resolvedTargetId
          && (edgeData.targetInputPortId || edge.targetHandle || 'default') === targetPort;
        const matchesBinding = matchesTargetPort
          && edge.source === resolvedSourceId
          && (edgeData.sourceOutputPortId || edge.sourceHandle || 'default') === sourcePort;
        if (isConditionalEdge || matchesBinding) {
          return true;
        }
        if (matchesTargetPort) {
          changedEdgeIds.add(edge.id);
        }
        return !matchesTargetPort;
      });

      if (!nextEdges.some((edge) => {
        const edgeData = (edge.data || {}) as { sourceOutputPortId?: string; targetInputPortId?: string };
        return edge.source === resolvedSourceId
          && edge.target === resolvedTargetId
          && (edgeData.sourceOutputPortId || edge.sourceHandle || 'default') === sourcePort
          && (edgeData.targetInputPortId || edge.targetHandle || 'default') === targetPort;
      })) {
        nextEdges = [
          ...nextEdges,
          markEdgeChanged(createProgrammaticEdge(resolvedSourceId, resolvedTargetId, sourcePort, targetPort)),
        ];
      }
    };

    const upsertNodeOutputBinding = (
      resolvedTargetId: string,
      targetPort: string,
      resolvedSourceId: string,
      sourcePort: string,
      sourceKind: 'node-output' = 'node-output',
      iteration: 'current' | 'previous' = 'current',
    ) => {
      const targetTask = nextTasks.find((t) => t.id === resolvedTargetId);
      const sourceTask = nextTasks.find((t) => t.id === resolvedSourceId);
      if (!targetTask || !sourceTask) return;

      const targetInputPort = targetTask.inputPorts?.find((p) => p.id === targetPort);
      const sourceOutputPort = sourceTask.outputPorts?.find((p) => p.id === sourcePort);
      if (!targetInputPort || !sourceOutputPort) return;

      if (targetInputPort.artifactKind !== sourceOutputPort.artifactKind) {
        console.warn('[IntentApply] Dropped data binding with artifact kind mismatch:', {
          sourceNode: resolvedSourceId,
          sourcePort,
          sourceArtifactKind: sourceOutputPort.artifactKind,
          targetNode: resolvedTargetId,
          targetPort,
          targetArtifactKind: targetInputPort.artifactKind,
        });
        return;
      }

      nextDataBindings = nextDataBindings.filter(
        (b) => !(b.targetNode === resolvedTargetId && b.targetPort === targetPort),
      );

      nextDataBindings = [
        ...nextDataBindings,
        {
          // Suggestion-created bindings reuse the same id so retries overwrite instead of fan out.
          id: createIntentSuggestionBindingId(
            suggestionApplicationKey,
            resolvedTargetId,
            targetPort,
            resolvedSourceId,
            sourcePort,
            iteration,
          ),
          targetNode: resolvedTargetId,
          targetPort,
          sourceKind,
          sourceNode: resolvedSourceId,
          sourcePort,
          iteration,
        },
      ];

      mirrorNodeOutputBindingEdge(resolvedTargetId, targetPort, resolvedSourceId, sourcePort);

    };

    const upsertConstantBinding = (
      resolvedTargetId: string,
      targetPort: string,
      constantValue: unknown,
    ) => {
      const targetTask = nextTasks.find((t) => t.id === resolvedTargetId);
      const targetInputPort = targetTask?.inputPorts?.find((p) => p.id === targetPort);
      if (!targetTask || !targetInputPort || constantValue === undefined) return;

      nextDataBindings = nextDataBindings.filter(
        (b) => !(b.targetNode === resolvedTargetId && b.targetPort === targetPort),
      );

      nextDataBindings = [
        ...nextDataBindings,
        {
          id: createIntentSuggestionBindingId(
            suggestionApplicationKey,
            resolvedTargetId,
            targetPort,
            'constant',
            JSON.stringify(constantValue),
            'current',
          ),
          targetNode: resolvedTargetId,
          targetPort,
          sourceKind: 'constant',
          constantValue,
        },
      ];

    };

    const upsertStateBinding = (
      resolvedTargetId: string,
      targetPort: string,
      statePath: string,
    ) => {
      const targetTask = nextTasks.find((task) => task.id === resolvedTargetId);
      const targetInputPort = targetTask?.inputPorts?.find((port) => port.id === targetPort);
      if (!targetTask || !targetInputPort || !statePath) return;

      nextDataBindings = nextDataBindings.filter(
        (binding) => !(binding.targetNode === resolvedTargetId && binding.targetPort === targetPort),
      );
      nextDataBindings = [
        ...nextDataBindings,
        {
          id: createIntentSuggestionBindingId(
            suggestionApplicationKey,
            resolvedTargetId,
            targetPort,
            'state',
            statePath,
            'current',
          ),
          targetNode: resolvedTargetId,
          targetPort,
          sourceKind: 'state',
          statePath,
        },
      ];
    };

    const removeNodeOutputBinding = (
      resolvedTargetId: string,
      targetPort: string,
      resolvedSourceId: string,
      sourcePort: string,
    ) => {
      nextDataBindings = nextDataBindings.filter((binding) => !(
        binding.targetNode === resolvedTargetId
        && binding.targetPort === targetPort
        && binding.sourceKind === 'node-output'
        && binding.sourceNode === resolvedSourceId
        && binding.sourcePort === sourcePort
      ));
    };

    const appendIntentEdge = (
      sourceId: string,
      targetId: string,
      sourceOutputPortId: string,
      targetInputPortId: string,
      options?: { kind?: 'sequential' | 'conditional'; routerLabel?: string | null; priority?: number | null; autoBind?: boolean },
    ) => {
      const isConditional = options?.kind === 'conditional' || Boolean(options?.routerLabel);
      const targetTask = nextTasks.find((task) => task.id === targetId);
      const targetInputPort = targetTask?.inputPorts?.find((port) => port.id === targetInputPortId);
      if (targetInputPort?.required && !isConditional) {
        nextEdges = nextEdges.filter((edge) => {
          const edgeData = (edge.data || {}) as { targetInputPortId?: string; routerLabel?: string | null };
          const matchesTargetPort = edge.target === targetId
            && (edgeData.targetInputPortId || edge.targetHandle || 'default') === targetInputPortId;
          const isConditionalEdge = edge.type === 'conditional' || Boolean(edgeData.routerLabel);
          if (isConditionalEdge) {
            return true;
          }
          if (matchesTargetPort) {
            changedEdgeIds.add(edge.id);
          }
          return !matchesTargetPort;
        });
      }

      if (nextEdges.some((edge) => {
        const edgeData = (edge.data || {}) as { sourceOutputPortId?: string; targetInputPortId?: string; routerLabel?: string | null };
        return edge.source === sourceId
          && edge.target === targetId
          && (edgeData.sourceOutputPortId || edge.sourceHandle || 'default') === sourceOutputPortId
          && (edgeData.targetInputPortId || edge.targetHandle || 'default') === targetInputPortId
          && (edgeData.routerLabel ?? null) === (options?.routerLabel ?? null);
      })) {
        return;
      }

      nextEdges = [
        ...nextEdges,
        markEdgeChanged(createProgrammaticEdge(sourceId, targetId, sourceOutputPortId, targetInputPortId, {
          kind: isConditional ? 'conditional' : options?.kind,
          routerLabel: options?.routerLabel,
          priority: options?.priority,
        })),
      ];

      if (targetInputPort?.required && !isConditional && options?.autoBind !== false) {
        upsertNodeOutputBinding(targetId, targetInputPortId, sourceId, sourceOutputPortId);
      }
    };

    const reconcileRequiredNodeOutputBindings = () => {
      nextTasks.forEach((task) => {
        task.inputPorts?.forEach((port) => {
          if (!port.required) {
            return;
          }

          const incomingEdges = nextEdges.filter((edge) => {
            const edgeData = (edge.data || {}) as { targetInputPortId?: string; routerLabel?: string | null };
            const isConditionalEdge = edge.type === 'conditional' || Boolean(edgeData.routerLabel);
            return !isConditionalEdge
              && edge.target === task.id
              && (edgeData.targetInputPortId || edge.targetHandle || 'default') === port.id;
          });

          if (incomingEdges.length !== 1) {
            return;
          }

          const edge = incomingEdges[0];
          const edgeData = (edge.data || {}) as { sourceOutputPortId?: string };
          const sourceOutputPortId = edgeData.sourceOutputPortId || edge.sourceHandle || 'default';
          upsertNodeOutputBinding(task.id, port.id, edge.source, sourceOutputPortId);
        });
      });
    };

    const reconcileUnboundRequiredInputsByPort = () => {
      getUnboundRequiredPortsForTaskIds(nextTasks, nextDataBindings, changedNodeIds, flowEdgesToControlEdges(nextEdges)).forEach((unboundInput) => {
        const targetIndex = nextTasks.findIndex((task) => task.id === unboundInput.taskId);
        const targetTask = targetIndex >= 0 ? nextTasks[targetIndex] : null;
        const targetPort = targetTask?.inputPorts?.find((port) => port.id === unboundInput.portId);
        if (!targetTask || !targetPort) return;

        // Intent-created tasks are appended in execution order, so only earlier tasks are safe sources.
        const candidates = nextTasks.flatMap((task, taskIndex) => (taskIndex < targetIndex
          ? (task.outputPorts || [])
            .filter((port) => port.id === targetPort.id && port.artifactKind === targetPort.artifactKind)
            .map((port) => ({ taskId: task.id, portId: port.id }))
          : []));

        if (candidates.length !== 1) return;

        const candidate = candidates[0];
        upsertNodeOutputBinding(targetTask.id, targetPort.id, candidate.taskId, candidate.portId);
      });
    };

    const findUnboundRequiredInputs = (): Array<{ taskId: string; portId: string }> => {
      return getUnboundRequiredPortsForTaskIds(nextTasks, nextDataBindings, changedNodeIds, flowEdgesToControlEdges(nextEdges));
    };

    const warnInvalidRequiredInputs = () => {
      const unboundInputs = findUnboundRequiredInputs();
      if (unboundInputs.length === 0) {
        return;
      }

      console.warn('[IntentApply] Unbound required inputs on newly created tasks:', unboundInputs);
      if (shouldSave) {
        showWarning(t('intentBar.invalidRequiredBindings'));
      }
    };

    const applyDataBindingChange = (
      type: 'create_data_binding' | 'delete_data_binding',
      targetTaskId: string | null,
      targetNodeRef: string | null,
      targetPort: string,
      targetIteratorNodeRef?: string | null,
      sourceKind?: 'node-output' | 'constant' | 'state',
      sourceTaskId?: string | null,
      sourceNodeRef?: string | null,
      sourcePort?: string | null,
      sourceIteratorNodeRef?: string | null,
      iteration?: 'current' | 'previous',
      constantValue?: unknown,
      statePath?: string,
    ) => {
      const resolvedTargetId = resolveScopedTaskReference(targetTaskId, targetNodeRef, targetIteratorNodeRef);
      if (!resolvedTargetId || !targetPort) return;

      if (type === 'delete_data_binding') {
        const resolvedSourceId = resolveScopedTaskReference(sourceTaskId ?? null, sourceNodeRef ?? null, sourceIteratorNodeRef);
        if (resolvedSourceId && sourcePort) {
          nextDataBindings = nextDataBindings.filter(
            (b) => !(b.targetNode === resolvedTargetId && b.targetPort === targetPort && b.sourceKind === 'node-output' && b.sourceNode === resolvedSourceId && b.sourcePort === sourcePort),
          );
        } else {
          nextDataBindings = nextDataBindings.filter(
            (b) => !(b.targetNode === resolvedTargetId && b.targetPort === targetPort),
          );
        }
        return;
      }

      if (sourceKind === 'constant') {
        upsertConstantBinding(resolvedTargetId, targetPort, constantValue);
        return;
      }
      if (sourceKind === 'state') {
        upsertStateBinding(resolvedTargetId, targetPort, statePath || '');
        return;
      }

      const resolvedSourceId = resolveScopedTaskReference(sourceTaskId, sourceNodeRef, sourceIteratorNodeRef);
      if (!resolvedSourceId || !sourcePort) return;

      upsertNodeOutputBinding(
        resolvedTargetId,
        targetPort,
        resolvedSourceId,
        sourcePort,
        sourceKind ?? 'node-output',
        iteration ?? 'current',
      );
    };

    const applyEdgeChange = (
      type: 'create_edge' | 'delete_edge',
      sourceTaskId: string | null,
      sourceNodeRef: string | null,
      targetTaskId: string | null,
      targetNodeRef: string | null,
      targetIteratorNodeRef?: string | null,
      sourceOutputPortId?: string | null,
      targetInputPortId?: string | null,
      sourceIteratorNodeRef?: string | null,
      edgeKind?: 'sequential' | 'conditional',
      routerLabel?: string | null,
      priority?: number | null,
    ) => {
      const resolvedSourceId = resolveScopedTaskReference(sourceTaskId, sourceNodeRef, sourceIteratorNodeRef);
      const resolvedTargetId = resolveScopedTaskReference(targetTaskId, targetNodeRef, targetIteratorNodeRef);

      if (!resolvedSourceId || !resolvedTargetId || resolvedSourceId === resolvedTargetId) {
        return;
      }

      const sourceTask = nextTasks.find((task) => task.id === resolvedSourceId) || null;
      const targetTask = nextTasks.find((task) => task.id === resolvedTargetId) || null;
      if (!sourceTask || !targetTask) {
        return;
      }

      if (type === 'delete_edge') {
        const deletedEdges = nextEdges.filter((edge) => {
          const edgeData = (edge.data || {}) as { sourceOutputPortId?: string; targetInputPortId?: string; routerLabel?: string | null };
          return edgeMatchesIntentPortPair(
            {
              sourceId: edge.source,
              targetId: edge.target,
              sourceOutputPortId: edgeData.sourceOutputPortId || edge.sourceHandle || undefined,
              targetInputPortId: edgeData.targetInputPortId || edge.targetHandle || undefined,
              routerLabel: edgeData.routerLabel ?? null,
            },
            resolvedSourceId,
            resolvedTargetId,
            sourceOutputPortId,
            targetInputPortId,
            routerLabel,
          );
        });
        deletedEdges.forEach((edge) => changedEdgeIds.add(edge.id));
        nextEdges = nextEdges.filter((edge) => !deletedEdges.some((deletedEdge) => deletedEdge.id === edge.id));
        deletedEdges.forEach((edge) => {
          const edgeData = (edge.data || {}) as { sourceOutputPortId?: string; targetInputPortId?: string };
          const deletedSourceOutputPortId = edgeData.sourceOutputPortId || edge.sourceHandle || 'default';
          const deletedTargetInputPortId = edgeData.targetInputPortId || edge.targetHandle || 'default';
          removeNodeOutputBinding(resolvedTargetId, deletedTargetInputPortId, resolvedSourceId, deletedSourceOutputPortId);
        });
        return;
      }

      const resolvedPorts = resolveIntentEdgePorts(sourceTask, targetTask, sourceOutputPortId || routerLabel, targetInputPortId);
      if (!resolvedPorts) {
        console.warn('[IntentApply] Dropped edge with unresolved ports:', {
          sourceNode: resolvedSourceId,
          targetNode: resolvedTargetId,
          sourceOutputPortId: sourceOutputPortId || routerLabel,
          targetInputPortId,
        });
        return;
      }

      if (nextEdges.some((edge) => {
        const edgeData = (edge.data || {}) as { sourceOutputPortId?: string; targetInputPortId?: string; routerLabel?: string | null };
        return edgeMatchesIntentPortPair(
          {
            sourceId: edge.source,
            targetId: edge.target,
            sourceOutputPortId: edgeData.sourceOutputPortId || edge.sourceHandle || undefined,
            targetInputPortId: edgeData.targetInputPortId || edge.targetHandle || undefined,
            routerLabel: edgeData.routerLabel ?? null,
          },
          resolvedSourceId,
          resolvedTargetId,
          resolvedPorts.sourceOutputPortId,
          resolvedPorts.targetInputPortId,
          routerLabel,
        );
      })) {
        return;
      }

      nextEdges = nextEdges.filter((edge) => {
        const edgeData = (edge.data || {}) as { routerLabel?: string | null };
        const isConditionalEdge = edge.type === 'conditional' || Boolean(edgeData.routerLabel);
        const shouldReplace = !isConditionalEdge
          && edge.source === resolvedSourceId
          && edge.target === resolvedTargetId;
        if (shouldReplace) {
          changedEdgeIds.add(edge.id);
        }
        return !shouldReplace;
      });

      appendIntentEdge(
        resolvedSourceId,
        resolvedTargetId,
        resolvedPorts.sourceOutputPortId,
        resolvedPorts.targetInputPortId,
        buildIntentEdgeOptions(edgeKind, routerLabel, priority),
      );
    };

    if (suggestion.kind === 'single_change') {
      const change = singleChanges[0];
      const targetTask = change.targetTaskId ? nextTasks.find((task) => task.id === change.targetTaskId) || null : selectedTask;
      if (change.type === 'delete_node') {
        if (!targetTask) {
          commitGraph(nextTasks, nextEdges, nextDataBindings);
          return;
        }
        deleteTaskAndBridgeEdges(targetTask.id);
        commitGraph(nextTasks, nextEdges, nextDataBindings);
        if (shouldSave) {
          void saveCurrentPlaybook({
            expectedDefinitionRevision: suggestionBaseDefinitionRevision,
            clientMutationId: suggestionApplicationKey,
          });
        }
        return;
      }
      if (change.type === 'update_node') {
        if (!targetTask) {
          commitGraph(nextTasks, nextEdges, nextDataBindings);
          return;
        }
        if (!change.task) return;
        nextTasks = nextTasks.map((task) => task.id === targetTask.id
          ? applyUpdateNodePorts(targetTask.id, task, change.task!)
          : task);
        changedNodeIds.add(targetTask.id);
        commitGraph(nextTasks, nextEdges, nextDataBindings);
        if (shouldSave) {
          void saveCurrentPlaybook({
            expectedDefinitionRevision: suggestionBaseDefinitionRevision,
            clientMutationId: suggestionApplicationKey,
          });
        }
        return;
      }
      if (!change.task) return;
      applyCreate(
        'single-change',
        change.task.title || '',
        change.task.description || '',
        change.task.agentSlug,
        change.task.nodeTemplateKey,
        change.task.inputPorts,
        change.task.outputPorts,
        change.task.nodeType,
        change.task.taskType,
        change.task.iteratorBody,
        change.task.routerConfig,
        change.task.humanApprovalConfig,
        change.task.retryPolicy,
        change.task.modelId,
        change.anchorMode,
        change.targetTaskId,
        null,
        null,
        undefined,
        undefined,
        undefined,
        undefined,
        change.task.toolBindings,
        change.task.skillBindings,
      );
      reconcileRequiredNodeOutputBindings();
      reconcileUnboundRequiredInputsByPort();
      warnInvalidRequiredInputs();

      commitGraph(nextTasks, nextEdges, nextDataBindings);
      if (shouldSave) {
        void saveCurrentPlaybook({
          expectedDefinitionRevision: suggestionBaseDefinitionRevision,
          clientMutationId: suggestionApplicationKey,
        });
      }
      return;
    }

    const orderedChanges = [
      ...suggestion.changes.filter((change) => change.type === 'delete_data_binding'),
      ...suggestion.changes.filter((change) => change.type !== 'delete_node' && change.type !== 'delete_edge' && change.type !== 'delete_data_binding'),
      ...suggestion.changes.filter((change) => change.type === 'delete_edge'),
      ...suggestion.changes.filter((change) => change.type === 'delete_node'),
    ];

    for (const change of orderedChanges) {
      if (change.type === 'create_node') {
        applyCreate(
          change.nodeRef,
          change.task.title,
          change.task.description,
          change.task.agentSlug,
          change.task.nodeTemplateKey,
          change.task.inputPorts,
          change.task.outputPorts,
          change.task.nodeType,
          change.task.taskType,
          change.task.iteratorBody,
          change.task.routerConfig,
          change.task.humanApprovalConfig,
          change.task.retryPolicy,
          change.task.modelId,
          change.anchor.mode,
          change.anchor.targetTaskId,
          change.anchor.nodeRef,
          change.nodeRef,
          change.anchor.targetTaskIds,
          change.anchor.nodeRefs,
          change.anchor.sourceOutputPortId,
          change.anchor.targetInputPortId,
          change.task.toolBindings,
          change.task.skillBindings,
        );
        continue;
      }

      if (change.type === 'create_edge' || change.type === 'delete_edge') {
        applyEdgeChange(
          change.type,
          change.sourceTaskId,
          change.sourceNodeRef,
          change.targetTaskId,
          change.targetNodeRef,
          change.targetIteratorNodeRef,
          change.sourceOutputPortId,
          change.targetInputPortId,
          change.sourceIteratorNodeRef,
          change.edgeKind,
          change.routerLabel,
          change.priority,
        );
        continue;
      }

      if (change.type === 'create_data_binding') {
        if (change.sourceKind === 'constant') {
          applyDataBindingChange(
            'create_data_binding',
            change.targetTaskId,
            change.targetNodeRef,
            change.targetPort,
            change.targetIteratorNodeRef,
            change.sourceKind,
            null,
            null,
            null,
            null,
            undefined,
            change.constantValue,
          );
        } else if (change.sourceKind === 'state') {
          applyDataBindingChange(
            'create_data_binding',
            change.targetTaskId,
            change.targetNodeRef,
            change.targetPort,
            change.targetIteratorNodeRef,
            change.sourceKind,
            null,
            null,
            null,
            null,
            undefined,
            undefined,
            change.statePath,
          );
        } else {
          applyDataBindingChange(
            'create_data_binding',
            change.targetTaskId,
            change.targetNodeRef,
            change.targetPort,
            change.targetIteratorNodeRef,
            change.sourceKind,
            change.sourceTaskId,
            change.sourceNodeRef,
            change.sourcePort,
            change.sourceIteratorNodeRef,
            change.iteration,
          );
        }
        continue;
      }

      if (change.type === 'delete_data_binding') {
        applyDataBindingChange(
          'delete_data_binding',
          change.targetTaskId,
          change.targetNodeRef,
          change.targetPort,
          change.targetIteratorNodeRef,
          undefined,
          change.sourceTaskId ?? undefined,
          change.sourceNodeRef ?? undefined,
          change.sourcePort ?? undefined,
          change.sourceIteratorNodeRef ?? undefined,
        );
        continue;
      }

        if (change.type === 'update_node') {
          if (nextTasks.some((task) => task.id === change.targetTaskId)) {
            nextTasks = nextTasks.map((task) => task.id === change.targetTaskId
              ? applyUpdateNodePorts(change.targetTaskId, task, change.task)
              : task);
            changedNodeIds.add(change.targetTaskId);
        }
        continue;
      }

      if (change.type === 'delete_node' && nextTasks.some((task) => task.id === change.targetTaskId)) {
        deleteTaskAndBridgeEdges(change.targetTaskId);
      }
    }

    nextTasks = nextTasks.map((task) => remapRouterConditionSourceNodes(task, createdNodeRefs));

    reconcileRequiredNodeOutputBindings();
    reconcileUnboundRequiredInputsByPort();

    const tasksChanged = changedNodeIds.size > 0 || changedEdgeIds.size > 0;
    const graphChanged = nextTasks.length !== (options?.replaceAll ? 0 : graphPlaybook.tasks.length) || nextEdges.length !== (options?.replaceAll ? 0 : graphEdges.length) || nextDataBindings.length !== (options?.replaceAll ? 0 : (graphPlaybook.dataBindings ?? []).length);
    if (!tasksChanged && !graphChanged) {
      if (shouldSave) {
        showError('No valid changes to apply from this suggestion');
      }
      if (shouldClearSuggestions) setIntentSuggestions([]);
      return;
    }

    if (applicationWarnings.length > 0) {
      console.warn('[IntentApply] Warnings:', applicationWarnings);
    }

    const unboundRequiredInputs = findUnboundRequiredInputs();
    if (unboundRequiredInputs.length > 0) {
      console.warn('[IntentApply] Unbound required inputs on newly created tasks:', unboundRequiredInputs);
      if (shouldSave) {
        showWarning(t('intentBar.invalidRequiredBindings'));
      }
    }

    commitGraph(nextTasks, nextEdges, nextDataBindings);
    if (shouldClearSuggestions) setIntentSuggestions([]);
    if (shouldSave && unboundRequiredInputs.length === 0) {
      void saveCurrentPlaybook({
        expectedDefinitionRevision: suggestionBaseDefinitionRevision,
        clientMutationId: suggestionApplicationKey,
      });
    }
  }, [captureSnapshot, createProgrammaticEdge, defaultAgents, edges, focusChangedArea, focusConstructionNode, playbook, saveCurrentPlaybook, selectStep, selectedStepId, setEdges, setNodes, t, updateDataBindings, updateEdges, updateTasks]);

  const handleCancelIntentConstruction = useCallback(() => {
    constructionAbortRef.current?.abort();
    if (id && constructionId) {
      void cancelPlaybookIntentConstruction(id, constructionId);
    }
    setConstructionProgress('');
  }, [constructionId, id]);

  const captureConstructionUndoCheckpoint = useCallback(() => {
    const state = usePlaybookStore.getState();
    const current = state.currentPlaybook;
    if (!current) return;
    const checkpoint = {
      undoStack: structuredClone(state.undoStack),
      snapshot: {
        tasks: structuredClone(current.tasks),
        edges: structuredClone(current.edges),
        dataBindings: structuredClone(current.dataBindings ?? []),
        name: current.name,
        workspaces: [...current.workspaces],
      },
    };
    constructionUndoCheckpointRef.current = checkpoint;
    usePlaybookStore.setState({
      undoStack: [...checkpoint.undoStack, checkpoint.snapshot],
      redoStack: [],
    });
  }, []);

  const stabilizeConstructionUndoCheckpoint = useCallback(() => {
    const checkpoint = constructionUndoCheckpointRef.current;
    if (!checkpoint) return;
    usePlaybookStore.setState({
      undoStack: [...checkpoint.undoStack, structuredClone(checkpoint.snapshot)],
      redoStack: [],
    });
    constructionUndoCheckpointRef.current = null;
  }, []);

  const rollbackIntentConstruction = useCallback(() => {
    const checkpoint = constructionUndoCheckpointRef.current;
    if (!checkpoint) return;
    usePlaybookStore.setState((state) => ({
      currentPlaybook: state.currentPlaybook
        ? {
            ...state.currentPlaybook,
            tasks: structuredClone(checkpoint.snapshot.tasks),
            edges: structuredClone(checkpoint.snapshot.edges),
            dataBindings: structuredClone(checkpoint.snapshot.dataBindings),
            name: checkpoint.snapshot.name,
            workspaces: [...checkpoint.snapshot.workspaces],
          }
        : null,
      undoStack: structuredClone(checkpoint.undoStack),
      redoStack: [],
      isDirty: false,
    }));
    constructionUndoCheckpointRef.current = null;
  }, []);

  const finalizeIntentConstruction = useCallback(async (baseDefinitionRevision: number, operationId: string) => {
    await saveCurrentPlaybook({
      expectedDefinitionRevision: baseDefinitionRevision,
      clientMutationId: `intent-construction-${operationId}`,
      assistantOperationId: operationId,
    });
    const state = usePlaybookStore.getState();
    if (state.isDirty || state.isSaving) {
      throw new Error(t('intentBar.error'));
    }
    stabilizeConstructionUndoCheckpoint();
  }, [saveCurrentPlaybook, stabilizeConstructionUndoCheckpoint, t]);

  const markAdvisorPreviewReady = useCallback((operationId: string, baseDefinitionRevision: number) => {
    setAssistantOperation({ id: operationId, target: 'advisor_preview', baseDefinitionRevision, status: 'ready' });
  }, [setAssistantOperation]);

  const applyAdvisorPreview = useCallback(async () => {
    if (!assistantOperationId || assistantOperationTarget !== 'advisor_preview' || assistantBaseDefinitionRevision == null) return;
    setAssistantPreviewStatus('applying');
    try {
      await saveCurrentPlaybook({
        expectedDefinitionRevision: assistantBaseDefinitionRevision,
        clientMutationId: `advisor-preview-${assistantOperationId}`,
        assistantOperationId,
        assistantOperationTarget: 'advisor_preview',
      });
      const state = usePlaybookStore.getState();
      if (state.isDirty || state.isSaving) throw new Error(t('intentBar.error'));
      stabilizeConstructionUndoCheckpoint();
      clearAssistantOperation();
      if (state.currentPlaybook?.id && state.currentPlaybook.id !== id) {
        navigate(`/playbooks/${state.currentPlaybook.id}`, { replace: true });
      }
    } catch (error) {
      setAssistantPreviewStatus('ready');
      showError(error instanceof Error ? error.message : t('intentBar.error'));
    }
  }, [assistantBaseDefinitionRevision, assistantOperationId, assistantOperationTarget, clearAssistantOperation, id, navigate, saveCurrentPlaybook, setAssistantPreviewStatus, showError, stabilizeConstructionUndoCheckpoint, t]);

  const discardAdvisorPreview = useCallback(async () => {
    if (!id || !assistantOperationId || assistantOperationTarget !== 'advisor_preview') return;
    setAssistantPreviewStatus('discarding');
    try {
      await discardPlaybookIntentConstruction(id, assistantOperationId);
      rollbackIntentConstruction();
      setConstructionStatus('cancelled');
      setConstructionProgress('');
      clearAssistantOperation();
    } catch (error) {
      setAssistantPreviewStatus('ready');
      showError(error instanceof Error ? error.message : t('intentBar.error'));
    }
  }, [assistantOperationId, assistantOperationTarget, clearAssistantOperation, id, rollbackIntentConstruction, setAssistantPreviewStatus, showError, t]);

  const getCurrentDefinitionRevision = useCallback(() => {
    return usePlaybookStore.getState().currentPlaybook?.definitionRevision ?? (playbook?.definitionRevision ?? 0);
  }, [playbook?.definitionRevision]);

  const handleReviewConstructionDiagnostic = useCallback((diagnostic: PlaybookIntentDiagnostic) => {
    const nodeId = resolveDiagnosticNodeId(diagnostic, constructionId, playbook?.tasks || []);
    if (!nodeId || !playbook) return;
    selectStep(nodeId);
    focusConstructionNode(playbook.tasks, nodeId);
  }, [constructionId, focusConstructionNode, playbook, selectStep]);

  const { handleSubmitIntent, handleSubmitIntentText, handleForceGenerateIntentText, handleApplyAdvisorIntent, consumePlaybookConstruction } = usePlaybookIntentFlow({
    id,
    playbook,
    selectedStepId,
    isDirty,
    intentValue,
    intentDesign,
    selectStep,
    assessPlaybookIntentDesign,
    startPlaybookIntentConstruction,
    streamPlaybookIntentConstruction,
    saveNow,
    captureConstructionSnapshot: captureConstructionUndoCheckpoint,
    rollbackConstruction: rollbackIntentConstruction,
    finalizeConstruction: finalizeIntentConstruction,
    handleApplyIntentSuggestion,
    setIntentLoading,
    setIntentError,
    setIntentDesign,
    setIntentSuggestions,
    setLastIntentSuggestions,
    startAdvisorRemediationConstruction,
    showError,
    showWarning,
    getCurrentDefinitionRevision,
    setConstructionStatus,
    setConstructionProgress,
    setConstructionId,
    setConstructionDiagnostics,
    constructionAbortRef,
    realtimeConstructionEnabled: playbookFeatures.mcpAssistantEnabled,
    setPreviewConstructionReady: markAdvisorPreviewReady,
  });

  useEffect(() => {
    const operationId = searchParams.get('assistantOperation');
    if (!id || !playbook || !operationId || consumedAssistantOperationRef.current === operationId) return;
    consumedAssistantOperationRef.current = operationId;
    void hydrateAssistantOperationHandoff(id, operationId, fetchPlaybookIntentConstruction, consumePlaybookConstruction).then(() => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('assistantOperation');
        return next;
      }, { replace: true });
    }).catch((error) => {
      const message = error instanceof Error ? error.message : t('intentBar.error');
      setConstructionStatus('failed');
      setConstructionProgress('');
      setIntentError(message);
      showError(message);
    });
  }, [consumePlaybookConstruction, id, playbook, searchParams, setConstructionProgress, setConstructionStatus, setSearchParams, showError, t]);

  const handleSubmitIntentFromDesigner = useCallback(async (intentText: string, visibleUserQuery: string, images?: PlaybookIntentImageInput[]) => {
    designerIntentRef.current = intentText;
    designerIntentImagesRef.current = images ?? [];
    if (shouldUsePlaybookAgentAssistant(playbookFeatures.agentAssistantEnabled, images) && id && playbook) {
      setIntentLoading(true);
      setIntentError('');
      try {
        if (isDirty) await saveNow();
        const response = await runPlaybookAssistantTurn(id, {
          message: intentText,
          expectedDefinitionRevision: getCurrentDefinitionRevision(),
          ...(selectedStepId && playbook.tasks.some((task) => task.id === selectedStepId)
            ? { selectedTaskId: selectedStepId }
            : {}),
          ...(currentExecution?.playbookId === id ? { executionId: currentExecution.id } : {}),
        });
        const constructionResult = response.operation
          ? await consumePlaybookConstruction({
              ...response.operation,
              constructionId: response.operation.constructionId ?? response.operation.operationId!,
            })
          : { status: 'completed' as const };
        const failed = constructionResult.status === 'failed';
        await appendDesignMessage(id, {
          userQuery: visibleUserQuery,
          aiSummary: failed ? (constructionResult.error || response.answer) : response.answer,
          status: failed ? 'failed' : 'completed',
          error: failed ? (constructionResult.error || response.answer) : null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : t('designer.intentFailedSummary');
        setIntentError(message);
        showError(message);
        try {
          await appendDesignMessage(id, {
            userQuery: visibleUserQuery,
            aiSummary: message,
            status: 'failed',
            error: message,
          });
        } catch (historyError) {
          console.error('Failed to save Designer Assistant failure', historyError);
        }
      } finally {
        setIntentLoading(false);
      }
      return;
    }
    const result = await handleSubmitIntentText(intentText, images);
    if (!id || result.status === 'skipped') return;
    try {
      await appendDesignMessage(id, {
        userQuery: visibleUserQuery,
        aiSummary: result.status === 'needs_clarification'
          ? t('designer.intentClarificationSummary')
          : result.status === 'failed'
            ? (result.error || t('designer.intentFailedSummary'))
            : t('designer.intentSavedSummary'),
        status: result.status === 'failed' ? 'failed' : 'completed',
        error: result.status === 'failed' ? (result.error || t('designer.intentFailedSummary')) : null,
      });
      await refreshIntentTraces();
    } catch (error) {
      console.error('Failed to save Designer Assistant chat history', error);
      showWarning(t('designer.intentSaveFailed'));
    }
  }, [consumePlaybookConstruction, currentExecution, getCurrentDefinitionRevision, handleSubmitIntentText, id, isDirty, playbook, refreshIntentTraces, saveNow, selectedStepId, showError, t]);

  const handleAnswerIntentFromDesigner = useCallback(async (answerText?: string) => {
    const result = await handleForceGenerateIntentText(designerIntentRef.current, answerText, designerIntentImagesRef.current);
    if (!id || !answerText || result.status === 'skipped') return;
    try {
      await appendDesignMessage(id, {
        userQuery: answerText,
        aiSummary: result.status === 'failed'
          ? (result.error || t('designer.intentFailedSummary'))
          : t('designer.intentSavedSummary'),
        status: result.status === 'failed' ? 'failed' : 'completed',
        error: result.status === 'failed' ? (result.error || t('designer.intentFailedSummary')) : null,
      });
      await usePlaybookStore.getState().fetchDesignMessages(id);
      await refreshIntentTraces();
    } catch (error) {
      console.error('Failed to save Designer Assistant clarification history', error);
      showWarning(t('designer.intentSaveFailed'));
    }
  }, [handleForceGenerateIntentText, id, t]);

  const { handleRun, handleStop } = usePlaybookCanvasExecutionHandlers({
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
    setDesignerOpen,
    setWorkspaceExplorerOpen,
    setConnectorSidebarOpen,
    setSkillSidebarOpen,
    setGlobalSidebarOpen,
    showError,
    workspaceRequiredForRunError: t('errors.workspaceRequiredForRun'),
  });

  const currentPlaybookExecution = currentExecution?.playbookId === id ? currentExecution : null;
  const executionHasHumanInput = execution?.waitingForHumanInput === true
    || execution?.status === 'interrupted'
    || execution?.taskResults.some((taskResult) => taskResult.status === 'interrupted') === true;
  const currentExecutionHasHumanInput = currentPlaybookExecution?.waitingForHumanInput === true
    || currentPlaybookExecution?.status === 'interrupted'
    || currentPlaybookExecution?.taskResults.some((taskResult) => taskResult.status === 'interrupted') === true;
  const executionWithHumanInput = executionHasHumanInput
    ? execution
    : currentExecutionHasHumanInput
      ? currentPlaybookExecution
      : currentPlaybookExecution ?? execution;
  const waitingForHumanInput = executionWithHumanInput?.waitingForHumanInput === true;
  const interruptedTaskId = executionWithHumanInput?.taskResults.find((taskResult) => taskResult.status === 'interrupted')?.taskId;
  const shouldOpenHumanInput = waitingForHumanInput || executionWithHumanInput?.status === 'interrupted';
  const humanInputKey = shouldOpenHumanInput
    ? `${executionWithHumanInput?.id ?? ''}:${executionWithHumanInput?.currentInterruptId ?? executionWithHumanInput?.interruptPayload?.interruptId ?? interruptedTaskId ?? 'interrupted'}`
    : null;

  const {
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
  } = usePlaybookCanvasPageHandlers({
    id,
    playbook,
    nameValue,
    nodeReflectionEnabled,
    advisorScoringMode,
    advisorAutopilotEnabled,
    pageMode,
    designerOpen,
    confirmRemoveAllMessage: `${t('toolbar.confirmRemoveAllTitle')}\n${t('toolbar.confirmRemoveAllDescription')}`,
    workspaceRequiredError: t('errors.workspaceRequired'),
    importReadErrorMessage: t('import.readError'),
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
  });

  useEffect(() => {
    const previousStatus = previousConstructionStatusRef.current;
    previousConstructionStatusRef.current = constructionStatus;
    if (!shouldAutoLayoutAfterConstruction(previousStatus, constructionStatus)) {
      return;
    }
    // Each streamed delta is already laid out; completion only reframes the final graph.
    let frameOne = 0;
    let frameTwo = 0;
    frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => {
        void reactFlow.fitView({
          padding: 0.12,
          duration: 350,
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
    };
  }, [constructionStatus, reactFlow]);

  useEffect(() => {
    if (!autoIntentRef.current) return;
    if (!playbook || !id || isGeneratingRoute || playbookLoading || playbook.id !== id) return;
    autoIntentRef.current = null;
    void handleSubmitIntent();
  }, [playbook, playbookLoading, id, isGeneratingRoute, handleSubmitIntent]);

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
    setAdvisorScoringMode(playbook.advisorScoringMode === 'heuristic' ? 'heuristic' : 'llm');
  }, [playbook?.reflectionEnabled, playbook?.advisorScoringMode]);

  useEffect(() => {
    if (!playbook) return;
    setAdvisorAutopilotEnabled((playbook.advisorAutopilotEnabled ?? false) === true);
  }, [playbook?.advisorAutopilotEnabled]);

  const handleToggleDeepSearch = useCallback(() => {
    if (!id || !playbook) return;
    const currentDeepSearch = playbook.tasks.some((t) => t.deepSearch);
    const newValue = !currentDeepSearch;
    updateTasks(playbook.tasks.map((t) => ({ ...t, deepSearch: newValue })));
    toast.success(newValue ? t('floatingToolbar.deepSearchOn') : t('floatingToolbar.deepSearchOff'));
  }, [id, playbook, updateTasks, t]);

  useEffect(() => {
    if (!id || !executionForCanvas || executionForCanvas.status !== 'interrupted' || executionForCanvas.waitingForHumanInput) {
      return;
    }
    if (pendingInterruptFetchRef.current === executionForCanvas.id) {
      return;
    }
    pendingInterruptFetchRef.current = executionForCanvas.id;
    void fetchExecution(id, executionForCanvas.id).finally(() => {
      if (pendingInterruptFetchRef.current === executionForCanvas.id) {
        pendingInterruptFetchRef.current = null;
      }
    });
  }, [executionForCanvas, fetchExecution, id]);

  useEffect(() => {
    const previousHumanInputKey = previousHumanInputKeyRef.current;
    previousHumanInputKeyRef.current = humanInputKey;

    if (!humanInputKey || previousHumanInputKey === humanInputKey) {
      return;
    }

    setDesignerOpen(true);
    setCopilotMode('interrupt');
  }, [humanInputKey, setCopilotMode, setDesignerOpen]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: any) => {
      if (editorOpen) setEditorOpen(false);

      const executionForSelection =
        currentExecution?.playbookId === id
          ? currentExecution
          : execution;

      if (executionForSelection && pageMode === 'run') {
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
      if ((edge.data as { runtime?: boolean } | undefined)?.runtime) {
        return;
      }
      if ((edge.data as { layer?: string } | undefined)?.layer === 'binding') {
        return;
      }
      const edgeData = (edge.data || {}) as { sourceOutputPortId?: string; targetInputPortId?: string };
      const sourceOutputPortId = edgeData.sourceOutputPortId || edge.sourceHandle || 'default';
      const targetInputPortId = edgeData.targetInputPortId || edge.targetHandle || 'default';
      captureSnapshot();
      setEdges((currentEdges: Edge[]) => {
        const updated = currentEdges.filter((candidate) => candidate.id !== edge.id);
        updateEdges(flowEdgesToPlaybookEdges(updated));
        return updated;
      });
      const currentBindings = playbook?.dataBindings ?? [];
      const updatedBindings = currentBindings.filter((binding) => {
        if (binding.targetNode !== edge.target || binding.targetPort !== targetInputPortId) {
          return true;
        }

        if (binding.sourceKind === 'trigger') {
          return binding.triggerPath !== sourceOutputPortId;
        }

        return !(binding.sourceNode === edge.source && binding.sourcePort === sourceOutputPortId);
      });
      if (updatedBindings.length !== currentBindings.length) {
        updateDataBindings(updatedBindings);
      }
    },
    [captureSnapshot, playbook?.dataBindings, setEdges, updateDataBindings, updateEdges],
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
  const renderCanvasViewModeButtons = (shortLabels: boolean) => (
    <>
      <Button
        type="button"
        variant={canvasViewMode === 'expanded' ? 'default' : 'ghost'}
        size="sm"
        className="h-8 rounded-full px-2 text-[11px] sm:px-3 sm:text-xs"
        aria-pressed={canvasViewMode === 'expanded'}
        onClick={() => setCanvasViewMode('expanded')}
      >
        {t(shortLabels ? 'canvas.view.expandedShort' : 'canvas.view.expanded')}
      </Button>
      <Button
        type="button"
        variant={canvasViewMode === 'overview' ? 'default' : 'ghost'}
        size="sm"
        className="h-8 rounded-full px-2 text-[11px] sm:px-3 sm:text-xs"
        aria-pressed={canvasViewMode === 'overview'}
        onClick={() => setCanvasViewMode('overview')}
      >
        {t(shortLabels ? 'canvas.view.overviewShort' : 'canvas.view.overview')}
      </Button>
    </>
  );

  return (
    <div className="flex flex-col h-full w-full">
      {typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed left-2 top-16 z-20 inline-flex rounded-full border bg-background/95 p-1 shadow-sm backdrop-blur sm:hidden"
              role="group"
              aria-label={t('canvas.view.groupLabel')}
            >
              {renderCanvasViewModeButtons(true)}
            </div>,
            document.body,
          )
        : null}
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
          {playbook.accessLevel !== 'read' && playbook.accessLevel !== 'write' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShareDialogOpen(true)}
              title={t('share.share')}
            >
              <Share2 className="h-4 w-4" />
            </Button>
          )}
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
            onRun={handleRun}
            onStop={handleStop}
            onSave={saveNow}
            onViewExecutions={handleViewExecutions}
            isDirty={isDirty}
            isSaving={isSaving}
            isExecuting={isExecuting}
            hasActiveExecution={hasActiveExecution}
            isStopping={isStopping}
            canRun={(playbook.tasks.length > 0 || (playbook.nodes?.length || 0) > 0) && (playbook.workspaces?.length || 0) > 0 && !hasActiveExecution && !isSaving && !isDirty}
            validationIssues={validationIssues}
            onValidationIssueSelect={handleValidationIssueSelect}
            nodeReflectionEnabled={nodeReflectionEnabled}
            onNodeReflectionChange={handleNodeReflectionChange}
            advisorAutopilotEnabled={advisorAutopilotEnabled}
            onAdvisorAutopilotChange={handleAdvisorAutopilotChange}
            advisorScoringMode={advisorScoringMode}
            onAdvisorScoringModeChange={handleAdvisorScoringModeChange}
            onDownloadAllResults={handleDownloadAllResults}
            canDownloadAllResults={Boolean(activeDownloadExecution?.taskResults?.length)}
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
            onOpenFlowSettings={() => setFlowSettingsOpen(true)}
            onExport={handleExportPlaybook}
            onImport={() => importFileInputRef.current?.click()}
          />
        </div>
      </div>

      {id && playbook?.accessLevel !== 'read' && playbook?.accessLevel !== 'write' && (
          <PlaybookTriggersSheet
            open={triggersSheetOpen}
            onOpenChange={setTriggersSheetOpen}
            playbookId={id}
            schedule={playbook.executionSchedule}
          mailTrigger={playbook.triggers.find((trigger) => trigger.type === 'mail') ?? null}
        />
      )}
      {id && (
        <PlaybookFlowSettingsDrawer
          playbookId={id}
          open={flowSettingsOpen}
          onOpenChange={setFlowSettingsOpen}
          settings={playbook.settings || { recursionLimit: 25, maxParallelism: 4 }}
          onSettingsChange={(settings) => {
            void updatePlaybook(playbook.id, {
              settings: {
                ...(playbook.settings || { recursionLimit: 25, maxParallelism: 4 }),
                ...settings,
              },
            });
          }}
        />
      )}

      <input
        ref={importFileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={() => void handleImportFileSelect()}
      />
      <PlaybookImportWarningModal
        open={importWarningOpen}
        onOpenChange={(open) => { if (!open) handleImportCancel(); }}
        onConfirm={handleImportConfirm}
        importedName={pendingImport?.name ?? ''}
        isDirty={isDirty}
      />
      <ReferenceModePromptDialog
        prompt={referenceModePrompt}
        onClose={() => setReferenceModePrompt(null)}
        onChooseMode={handleReferenceModeChoice}
      />

      {/* Main content area with optional workspace explorer */}
      <TooltipProvider delayDuration={300}>
      <div className="flex flex-1 overflow-hidden">
        {/* Workspace Explorer Sidebar */}
        <WorkspaceExplorerSidebar />
        <CommunityGraphPanel
          open={graphPanelOpen}
          onOpenChange={setGraphPanelOpen}
          workspaceId={playbook?.workspaces?.[0] ?? null}
        />

        {/* Connector Sidebar */}
        <ConnectorSidebar isOpen={connectorSidebarOpen} onDragStart={handleConnectorDragStart} />

        {/* Skill Sidebar */}
        <SkillSidebar isOpen={skillSidebarOpen} onDragStart={handleSkillDragStart} />

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
            <div
              ref={canvasViewModeRef}
              className="absolute left-4 top-4 z-20 hidden rounded-full border bg-background/95 p-1 shadow-sm backdrop-blur sm:inline-flex"
              role="group"
              aria-label={t('canvas.view.groupLabel')}
            >
              {renderCanvasViewModeButtons(false)}
              <Button
                type="button"
                size="sm"
                variant={executionViewMode === 'focus' ? 'default' : 'ghost'}
                disabled={executionRuntimeGraph.focusNodes.length === 0}
                aria-pressed={executionViewMode === 'focus'}
                onClick={() => {
                  setCanvasViewMode('expanded');
                  setExecutionViewMode((mode) => mode === 'focus' ? 'full' : 'focus');
                }}
              >
                {t('executionFocus.label')}
              </Button>
            </div>
            {canvasViewMode === 'overview' ? (
              <PlaybookOverviewCanvas
                nodes={canvasNodes}
                edges={styledControlEdges}
                resultNodeIds={overviewResultNodeIds}
                executableNodeIds={overviewExecutableNodeIds}
                executionDisabled={hasActiveExecution || isSaving || isDirty}
                onOpenNode={handleOpenOverviewNode}
                onOpenExecution={handleOpenOverviewExecution}
                onExecuteNode={(nodeId) => { void handleExecuteStep(nodeId); }}
              />
            ) : (
            <NodeContextMenuContext.Provider value={nodeContextMenuActions}>
              <NodeDataActionsContext.Provider value={{ updateNodeData, setIteratorNodeSize, resizeIteratorNode: handleResizeIteratorNode, repackIteratorChildren: handleRepackIteratorChildren, openOutputFormatEditor, onConnectorDrop: handleConnectorDrop, onSkillDrop: handleSkillDrop }}>
                <ConnectionDragContext.Provider value={{ hoveredTargetId: connectionDragHoveredId }}>
                <Canvas
                  nodes={renderedCanvasNodes}
                  edges={renderedCanvasEdges}
                  onNodesChange={onNodesChange}
                  onNodeDragStop={onNodeDragStop}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onConnectStart={onConnectStart}
                  onConnectEnd={onConnectEnd}
                  onNodeMouseEnter={onNodeMouseEnter}
                  onNodeMouseLeave={onNodeMouseLeave}
                  onNodeClick={handleNodeClick}
                  onNodeDoubleClick={handleNodeDoubleClick}
                  onEdgeDoubleClick={handleEdgeDoubleClick}
                  onPaneClick={handlePaneClick}
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
                  selectionOnDrag
                  selectionKeyCode="Shift"
                   deleteKeyCode={constructionActive || executionViewMode === 'focus' || executionRuntimeGraph.inlineNodes.length > 0 ? null : ['Backspace', 'Delete']}
                   nodesDraggable={shouldEnableCanvasNodeDragging(isSaving, constructionActive, executionViewMode)}
                   nodesConnectable={!isSaving && !constructionActive && executionViewMode === 'full' && executionRuntimeGraph.inlineNodes.length === 0}
                  elementsSelectable={!isSaving && !constructionActive}
                  onDrop={handleCanvasDrop}
                  onDragOver={(e) => { e.preventDefault(); }}
                >
                  <Controls
                    position="bottom-left"
                    onFitView={() => {
                      if (designerSidebarWidth <= 0) return;
                      window.setTimeout(() => {
                        void fitCanvasNodes(renderedCanvasNodes);
                      }, 100);
                    }}
                  />
                </Canvas>
                {intentLoading ? <PlaybookIntentGhostNode progress={constructionProgress} /> : null}
                <PlaybookCanvasFloatingToolbar
                  ref={floatingToolbarRef}
                  containerRef={canvasChromeRef}
                  avoidRectRef={canvasViewModeRef}
                  onAddStep={handleAddStep}
                  onAddRouterNode={handleAddRouterNode}
                  onAddHumanApprovalNode={handleAddHumanApprovalNode}
                  onAddStepFromTemplate={handleAddStepFromTemplate}
                  onAutoLayout={handleAutoLayout}
                  onUndo={undo}
                  onRedo={redo}
                  onToggleExplorer={() => setWorkspaceExplorerOpen(!workspaceExplorerOpen)}
                  onToggleConnectors={() => setConnectorSidebarOpen(!connectorSidebarOpen)}
                  onToggleSkills={() => setSkillSidebarOpen(!skillSidebarOpen)}
                  explorerOpen={workspaceExplorerOpen}
                  connectorsOpen={connectorSidebarOpen}
                  skillsOpen={skillSidebarOpen}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  disabled={isSaving || constructionActive}
                  onDownloadAllResults={handleDownloadAllResults}
                  onToggleDataBindings={() => setDataBindingsVisible((current) => !current)}
                  dataBindingsVisible={dataBindingsVisible}
                  canDownloadAllResults={Boolean(activeDownloadExecution?.taskResults?.length)}
                  onToggleDesigner={handleToggleCopilot}
                  designerOpen={designerOpen}
                  onRemoveAllTasks={handleRemoveAllTasks}
                  taskCount={playbook.tasks.length}
                  onCopySelection={() => { void copySelection(); }}
                  onCutSelection={() => { void cutSelection(); }}
                  onPasteClipboard={() => { void pasteClipboard(); }}
                  hasSelection={nodes.some((n) => n.selected && n.id !== '__trigger__')}
                  waitingForHumanInput={Boolean(waitingForHumanInput)}
                  interruptType={(executionWithHumanInput?.interruptPayload?.type ?? null) as InterruptType | null}
                  collapsed={toolbarCollapsed}
                  onCollapsedChange={setToolbarCollapsed}
                  minLeftOffset={TOOLBAR_MIN_LEFT_OFFSET}
                  deepSearch={playbook.tasks.some((t) => t.deepSearch)}
                  onToggleDeepSearch={() => { void handleToggleDeepSearch(); }}
                />
                </ConnectionDragContext.Provider>
              </NodeDataActionsContext.Provider>
            </NodeContextMenuContext.Provider>
            )}
            {isDesigning && (
              <PlaybookGeneratingOverlay
                title={t('canvas.designing')}
                subtitle={t('canvas.designingHint')}
              />
            )}
            <PlaybookDesignerPanel
              playbookId={id}
              intentDesign={intentDesign}
              intentLoading={intentLoading}
              history={intentHistory}
              constructionStatus={constructionStatus}
              constructionDiagnostics={constructionDiagnostics}
              intentTraces={intentTraces}
              intentTracesLoading={intentTracesLoading}
              onSubmitDesignIntent={handleSubmitIntentFromDesigner}
              onAnswerDesignIntent={handleAnswerIntentFromDesigner}
              onApplyHistorySuggestion={constructionActive
                ? undefined
                : (suggestion) => handleApplyIntentSuggestion(suggestion, { replaceAll: true })}
              onCancelConstruction={handleCancelIntentConstruction}
              onReviewConstructionDiagnostic={handleReviewConstructionDiagnostic}
              assistantPreviewStatus={assistantPreviewStatus}
              onApplyAssistantPreview={() => { void applyAdvisorPreview(); }}
              onDiscardAssistantPreview={() => { void discardAdvisorPreview(); }}
              onWidthChange={setDesignerSidebarWidth}
              onOpenIntentTraces={handleOpenIntentTraces}
            />
          </div>

          {isExecutionPanelVisible && (
            <ExecutionPanel
              playbookId={id}
              pageMode={pageMode}
              onApplyAdvisorIntent={handleApplyAdvisorIntent}
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
        ref={nodeEditorRef}
        playbookId={playbook.id}
        task={effectiveEditingTask}
        allTasks={playbook.tasks}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSave={handleNodeSave}
        onOpenOutputFormatEditor={openOutputFormatEditor}
      />

      <PlaybookNodeAdvisorDialog
        open={nodeAdvisorOpen}
        onOpenChange={setNodeAdvisorOpen}
        taskTitle={playbook.tasks.find((task) => task.id === nodeAdvisorTaskId)?.title || ''}
        loading={nodeAdvisorLoading}
        suggestions={nodeAdvisorSuggestions}
        onApply={handleApplyNodeAdvisorSuggestion}
      />

      {/* Share Dialog */}
      {id && (
        <SharePlaybookDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          playbookId={id}
          playbookName={playbook?.name ?? ''}
        />
      )}

      <Dialog open={evaluationDialogOpen} onOpenChange={setEvaluationDialogOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-6xl grid-rows-[auto_minmax(0,1fr)] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('evaluationDialog.title')}</DialogTitle>
            <DialogDescription>{t('evaluationDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto pr-1 space-y-4">
            {playbook && (
              <ReplayMigrationHarnessCard
                playbook={playbook}
                disabled={isExecuting || isSaving || !id}
                onRun={async ({ modelIdOverride, mode }) => {
                  if (!id || !playbook) return;
                  const stepExecutionModes = Object.fromEntries(
                    playbook.tasks
                      .filter((task) => task.enabled !== false && (task.activeReplayId || task.hasValidatedReplay))
                      .map((task) => [task.id, mode]),
                  );
                  if (Object.keys(stepExecutionModes).length === 0) return;
                  await executePlaybook(id, {
                    executionMode: 'inherit',
                    stepExecutionModes: stepExecutionModes as Record<string, 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive'>,
                    modelIdOverride,
                    runNodeReflection: nodeReflectionEnabled,
                  });
                  setEvaluationDialogOpen(false);
                }}
              />
            )}
            <RepeatabilityDetails
              repeatability={repeatability}
              loading={repeatabilityLoading}
              onPageFetch={(limit, offset) => fetchRepeatability(id!, limit, offset)}
              onExportFetch={(limit, offset) => getPlaybookRepeatability(id!, limit, offset)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingOutputFormatTaskId} onOpenChange={(nextOpen) => { if (!nextOpen) saveAndCloseOutputFormatDialog(); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingOutputFormatVersion
                ? t('outputFormatDialog.titleVersioned', { version: editingOutputFormatVersion })
                : t('outputFormatDialog.title')}
            </DialogTitle>
            <DialogDescription>{t('outputFormatDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleGenerateOutputFormat()}
                disabled={
                  outputFormatLoading
                  || outputFormatSaving
                  || outputFormatGenerating
                  || !canGenerateEditingOutputFormat
                }
              >
                {outputFormatGenerating ? t('outputFormatDialog.generating') : t('baselineBadge.generateOutputFormat')}
              </Button>
            </div>
            {editingOutputFormatTaskId && !canGenerateEditingOutputFormat && !outputFormatGenerating && (
              <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">
                {t('baselineBadge.generateOutputFormatDisabledHint')}
              </div>
            )}
            <div className="relative">
              <Textarea
                value={outputFormatDraft}
                onChange={(e) => setOutputFormatDraft(e.target.value)}
                rows={18}
                disabled={outputFormatLoading || outputFormatSaving || outputFormatGenerating}
                placeholder={outputFormatLoading ? t('outputFormatDialog.loadingPlaceholder') : t('outputFormatDialog.placeholder')}
              />
              {outputFormatGenerating && (
                <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{t('outputFormatDialog.generating')}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => void handleRemoveOutputFormat()}
              disabled={outputFormatLoading || outputFormatSaving || outputFormatGenerating || !editingOutputFormatVersion}
            >
              {t('outputFormatDialog.remove')}
            </Button>
            <Button
              variant="outline"
              onClick={() => closeOutputFormatDialog(false)}
              disabled={outputFormatSaving || outputFormatGenerating}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void handleSaveOutputFormat()}
              disabled={outputFormatLoading || outputFormatSaving || outputFormatGenerating || !outputFormatDraft.trim()}
            >
              {outputFormatSaving ? t('outputFormatDialog.saving') : t('outputFormatDialog.save')}
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

      {artifactKindMismatch && (
        <ArtifactKindMismatchDialog {...artifactKindMismatch} />
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
