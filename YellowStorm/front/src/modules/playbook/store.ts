/**
 * Playbook Store
 * Zustand store for playbook management
 */

import { create, type StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from '@/lib/notifications';
import type {
  PlaybookStore,
  PlaybookState,
  PlaybookQueryParams,
  GeneratePlaybookData,
  DesignPlaybookData,
  DesignMessage,
  Playbook,
  PlaybookSummary,
  PlaybookTask,
  PlaybookEdge,
  ControlEdge,
  DataBinding,
  PlaybookExecution,
  PlaybookExecutionSummary,
  PlaybookExecutionStartEvent,
  PlaybookStepStartEvent,
  PlaybookStepUpdateEvent,
  PlaybookStepCompleteEvent,
  PlaybookIteratorChildStepStartEvent,
  PlaybookIteratorChildStepUpdateEvent,
  PlaybookIteratorChildStepCompleteEvent,
  PlaybookStepEvaluationUpdatedEvent,
  PlaybookStepJudgeStartedEvent,
  PlaybookStepJudgeUpdatedEvent,
  PlaybookJudgeSummaryUpdatedEvent,
  PlaybookAdvisorAutopilotUpdatedEvent,
  PlaybookReplayFormatGuideUpdatedEvent,
  PlaybookOutputFormatTemplateUpdatedEvent,
  PlaybookExecutionCompleteEvent,
  PlaybookInterruptEvent,
  DynamicReasoningStreamUpdate,
  ExecutionStatus,
  StepEvaluationHistoryEntry,
  PlaybookPageMode,
  PlaybookUndoSnapshot,
  ExecutePlaybookData,
  SyncPlaybookMailSubscriptionData,
  TaskTemplate,
  ArtifactKind,
  UpsertPlaybookMailTriggerData,
  UpsertPlaybookScheduleData,
  ToolBinding,
  RequestPlaybookIntentData,
  AdvisorScriptReplacementApplyRequest,
  AdvisorScriptReplacementRequest,
  IntentSuggestionHistoryEntry,
  PlaybookIntentSuggestion,
  PlaybookResourceReference,
    PlaybookDefinitionExport,
    UpdatePlaybookData,
    UpdateFlowData,
    InterruptPayload,
} from './types';
import * as api from './api';
import { normalizePlaybook } from './api.compat';
import { autoLayoutTasks } from './utils/auto-layout';
import { mergeComponents } from './utils/merge-components';
import { mergeDynamicReasoningUpdate } from './stream/executionEventMerger';
import { handleApiError, parseApiError } from '@/lib/api-error';
import { ErrorCode } from '@/lib/error-codes';
import { i18nInstance } from '@/modules/localization/i18nInstance';
import { playbookFeatures } from './features';
import { usePlaybookUiStore } from './uiStore';
import { playbookQueryClient } from './query/queryClient';
import { playbookKeys } from './query/queryKeys';
import {
  cancelExecutionMutation,
  clonePlaybookMutation,
  createPlaybookMutation,
  deletePlaybookMutation,
  designFlowMutation,
  patchFlowDeltaMutation,
  resumeApprovalMutation,
  resumeFromStepMutation,
  startExecutionMutation,
  updateFlowOutputFormatTemplateMutation,
  updateOutputFormatTemplateMutation,
  updatePlaybookMutation,
  upsertTriggerMailMutation,
  upsertTriggerScheduleMutation,
  validateFlowReplayMutation,
  validateReplayMutation,
} from './query/mutationActions';

function tPlaybook(key: string, fallback: string, options?: Record<string, unknown>) {
  if (i18nInstance.isInitialized) {
    return i18nInstance.t(key, { ns: 'playbook', defaultValue: fallback, ...options });
  }
  if (options) {
    let result = fallback;
    for (const [k, v] of Object.entries(options)) {
      result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
    return result;
  }
  return fallback;
}

function buildInterruptPayload(data: PlaybookInterruptEvent): InterruptPayload {
  return {
    type: data.type,
    taskId: data.taskId,
    taskTitle: '',
    message: data.message,
    threadId: data.threadId,
    interruptId: data.interruptId || '',
    round: data.round || 0,
    payloadJson: data.payloadJson || '',
    resumableActions: data.resumableActions || [],
    taskDescription: data.taskDescription || '',
    result: data.result || '',
    blockerRuleId: data.blockerRuleId,
    blockerKind: data.blockerKind,
    reasonCode: data.reasonCode,
    riskLevel: data.riskLevel,
    downstreamNodeIds: data.downstreamNodeIds,
    feedbackScopeDefault: data.feedbackScopeDefault,
  };
}

function removePendingInterrupt(
  pendingInterrupts: InterruptPayload[] | undefined,
  taskId: string,
  interruptId?: string,
): InterruptPayload[] {
  return (pendingInterrupts || []).filter((entry) => (
    interruptId ? entry.interruptId !== interruptId : entry.taskId !== taskId
  ));
}

const EXEC_PANEL_KEY = 'ys_playbook_exec_panel';
const WORKSPACE_EXPLORER_KEY = 'ys_workspace_explorer_open';
const INTENT_HISTORY_KEY = 'ys_playbook_intent_history';
const MAX_INTENT_HISTORY_PER_PLAYBOOK = 20;
const JUDGE_REFRESH_INTERVAL_MS = 1500;
const JUDGE_REFRESH_MAX_ATTEMPTS = 12;

function persistPanelOpen(open: boolean) {
  try { localStorage.setItem(EXEC_PANEL_KEY, open ? '1' : '0'); } catch { /* noop */ }
}

function persistWorkspaceExplorerOpen(open: boolean) {
  try { localStorage.setItem(WORKSPACE_EXPLORER_KEY, open ? '1' : '0'); } catch { /* noop */ }
}

function syncUiStoreForRun(taskId?: string | null) {
  usePlaybookUiStore.setState((state) => ({
    ...state,
    executionPanelOpen: true,
    workspaceExplorerOpen: false,
    connectorSidebarOpen: false,
    skillSidebarOpen: false,
    nodeEditorOpen: false,
    graphPanelOpen: false,
    pageMode: 'run',
    ...(taskId !== undefined ? { selectedStepId: taskId } : {}),
  }));
  persistPanelOpen(true);
}

function syncUiStoreForInterrupt(taskId: string) {
  usePlaybookUiStore.setState((state) => ({
    ...state,
    selectedStepId: taskId,
    designerOpen: true,
    copilotMode: 'interrupt',
    executionPanelOpen: true,
    workspaceExplorerOpen: false,
    connectorSidebarOpen: false,
    skillSidebarOpen: false,
    nodeEditorOpen: false,
    graphPanelOpen: false,
    pageMode: 'run',
  }));
  persistPanelOpen(true);
}

function isValidHistoryEntry(entry: unknown): entry is IntentSuggestionHistoryEntry {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  return typeof e.id === 'string' && !!e.suggestion && typeof e.suggestion === 'object' && typeof e.appliedAt === 'number';
}

function loadIntentHistory(): Record<string, IntentSuggestionHistoryEntry[]> {
  try {
    const raw = localStorage.getItem(INTENT_HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, IntentSuggestionHistoryEntry[]> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (Array.isArray(val)) {
        const valid = val.filter(isValidHistoryEntry);
        if (valid.length > 0) result[key] = valid;
      }
    }
    return result;
  } catch { return {}; }
}

function persistIntentHistory(history: Record<string, IntentSuggestionHistoryEntry[]>) {
  try { localStorage.setItem(INTENT_HISTORY_KEY, JSON.stringify(history)); } catch { /* noop */ }
}

function appendEvaluationHistory(
  history: StepEvaluationHistoryEntry[] | undefined,
  entry: StepEvaluationHistoryEntry | null | undefined,
): StepEvaluationHistoryEntry[] {
  if (!entry) return history || [];
  const existing = history || [];
  if (existing.some((item) => item.id === entry.id)) {
    return existing;
  }
  return [...existing, entry].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function buildResourceBindingValue(resource: PlaybookResourceReference): Record<string, unknown> {
  const value: Record<string, unknown> = {
    text: resource.content,
    kind: resource.kind,
    id: resource.id,
    label: resource.name,
    name: resource.name,
    workspaceId: resource.workspaceId,
    workspaceName: resource.workspaceName ?? (resource.kind === 'workspace' ? resource.name : undefined),
    path: resource.path,
    mimeType: resource.mimeType,
    metadata: resource.metadata,
  };
  if (resource.kind === 'document') {
    value.documentId = resource.id;
  }
  return value;
}

// ===== Initial State =====

const initialState: PlaybookState = {
  playbooks: [],
  playbooksLoading: false,
  playbooksPagination: null,
  playbooksQuery: {},
  currentPlaybook: null,
  currentPlaybookLoading: false,
  isDirty: false,
  dirtyVersion: 0,
  isSaving: false,
  saveRequestId: 0,
  savingDirtyVersion: null,
  lastSavedPayloadHashByPlaybookId: {},
  lastSavedRequestBodyByPlaybookId: {},
  lastAutosaveDurationMs: null,
  pendingAutosaveAfterCurrent: false,
  autosaveBackoffUntil: null,
  lastSaveReason: null,
  currentExecution: null,
  currentExecutionLoading: false,
  executionCache: {},
  executionHistory: [],
  executionHistoryByPlaybook: {},
  executionsLoading: false,
  executingPlaybookIds: [],
  isGenerating: false,
  generateRetryData: null,
  selectedStepId: null,
  selectedIterationIndex: 0,
  pendingRerunTaskId: null as string | null,
  error: null,
  designMessages: [],
  designMessagesLoading: false,
  isStopping: false,
  isDesigning: false,
  designerOpen: false,
  copilotMode: 'design',
  executionPanelOpen: (() => { try { return localStorage.getItem(EXEC_PANEL_KEY) === '1'; } catch { return false; } })(),
  executionDetailTab: 'results',
  workspaceExplorerOpen: (() => { try { return localStorage.getItem(WORKSPACE_EXPLORER_KEY) === '1'; } catch { return false; } })(),
  connectorSidebarOpen: false,
  skillSidebarOpen: false,
  nodeEditorOpen: false,
  graphPanelOpen: false,
  pageMode: 'design',
  undoStack: [],
  redoStack: [],
  perPlaybookUndoHistory: {},
  canvasSyncVersion: 0,
  triggerSaving: false,
  triggerError: null,
  nodeTemplates: [],
  nodeTemplatesLoading: false,
  nodeTemplatesLoadedAt: 0,
  evaluationExecutionsByTask: {},
  evaluationBaselinesByTask: {},
  repeatability: null,
  repeatabilityLoading: false,
  intentSuggestionHistory: loadIntentHistory(),
  flowNodeTemplates: [],
  flowNodeTemplatesLoading: false,
  flowNodeTemplatesLoadedAt: 0,
  flowNodeKinds: [],
  flowNodeKindsLoading: false,
  idempotencyKeyCounters: {},
  portInspection: null,
};

// ===== Stable empty references =====

const EMPTY_PLAYBOOKS: PlaybookSummary[] = [];
const EMPTY_EXECUTIONS: PlaybookExecutionSummary[] = [];
const EMPTY_DESIGN_MESSAGES: DesignMessage[] = [];
const MAX_EXECUTION_HISTORY = 50;

const judgeRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearJudgeRefreshTimer(executionId: string): void {
  const timer = judgeRefreshTimers.get(executionId);
  if (timer) {
    clearTimeout(timer);
    judgeRefreshTimers.delete(executionId);
  }
}

function scheduleJudgeRefresh(executionId: string, playbookId: string): void {
  clearJudgeRefreshTimer(executionId);

  let attempt = 0;
  const tick = () => {
    attempt += 1;
    void usePlaybookStore.getState().fetchExecution(playbookId, executionId)
      .then(() => {
        const execution = usePlaybookStore.getState().executionCache[executionId];
        const hasPendingEvaluations = execution?.taskResults?.some((task) => task.judgeStatus === 'evaluating') ?? false;

        if (!hasPendingEvaluations || attempt >= JUDGE_REFRESH_MAX_ATTEMPTS) {
          clearJudgeRefreshTimer(executionId);
          return;
        }

        judgeRefreshTimers.set(executionId, setTimeout(tick, JUDGE_REFRESH_INTERVAL_MS));
      })
      .catch(() => {
        if (attempt >= JUDGE_REFRESH_MAX_ATTEMPTS) {
          clearJudgeRefreshTimer(executionId);
          return;
        }
        judgeRefreshTimers.set(executionId, setTimeout(tick, JUDGE_REFRESH_INTERVAL_MS));
      });
  };

  judgeRefreshTimers.set(executionId, setTimeout(tick, JUDGE_REFRESH_INTERVAL_MS));
}
const MAX_EXECUTION_CACHE = 20;
const MAX_UNDO_HISTORY = 100;
const enablePlaybookDevtools =
  import.meta.env.DEV && import.meta.env.VITE_PLAYBOOK_DEVTOOLS_ENABLED === 'true';
const enablePlaybookDeltaAutosave = import.meta.env.VITE_PLAYBOOK_DELTA_AUTOSAVE_ENABLED === 'true';
let deltaAutosaveAvailableInSession = enablePlaybookDeltaAutosave;

export function __setDeltaAutosaveAvailableForTests(value: boolean): void {
  deltaAutosaveAvailableInSession = value;
}

function fetchPlaybookList(query: PlaybookQueryParams) {
  if (!playbookFeatures.queryEnabled) {
    return api.getPlaybooks(query);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.list(query),
    queryFn: () => api.getPlaybooks(query),
  });
}

function fetchFlowList(query?: PlaybookQueryParams) {
  const stableQuery = query ?? {};
  if (!playbookFeatures.queryEnabled) {
    return api.getFlows(query);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.flowList(stableQuery),
    queryFn: () => api.getFlows(query),
  });
}

function fetchLegacyPlaybookDetail(id: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getPlaybook(id);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.legacyDetail(id),
    queryFn: () => api.getPlaybook(id),
  });
}

function fetchPlaybookDetail(id: string, view: 'base' | 'enriched') {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlow(id, { view });
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.detail(id, view),
    queryFn: () => api.getFlow(id, { view }),
  });
}

function fetchDesignMessageList(playbookId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getDesignMessages(playbookId).then(sortDesignMessagesChronologically);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.designMessages(playbookId),
    queryFn: () => api.getDesignMessages(playbookId).then(sortDesignMessagesChronologically),
  });
}

function sortDesignMessagesChronologically(messages: DesignMessage[]) {
  return [...messages].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

function fetchPlaybookExecutionHistory(playbookId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getExecutions(playbookId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.executions(playbookId),
    queryFn: () => api.getExecutions(playbookId),
  });
}

function fetchPlaybookExecutionDetail(playbookId: string, executionId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getExecution(playbookId, executionId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.execution(executionId),
    queryFn: () => api.getExecution(playbookId, executionId),
  });
}

function fetchEvaluationExecutionList(playbookId: string, taskId?: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getEvaluationExecutions(playbookId, taskId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.evaluationExecutions(playbookId, taskId),
    queryFn: () => api.getEvaluationExecutions(playbookId, taskId),
  });
}

function fetchEvaluationBaselineDetail(playbookId: string, taskId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getEvaluationBaseline(playbookId, taskId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.evaluationBaseline(playbookId, taskId),
    queryFn: () => api.getEvaluationBaseline(playbookId, taskId),
  });
}

function fetchFlowEvaluationExecutionList(flowId: string, taskId?: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlowEvaluationExecutions(flowId, taskId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.flowEvaluationExecutions(flowId, taskId),
    queryFn: () => api.getFlowEvaluationExecutions(flowId, taskId),
  });
}

function fetchFlowEvaluationBaselineDetail(flowId: string, taskId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlowEvaluationBaseline(flowId, taskId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.flowEvaluationBaseline(flowId, taskId),
    queryFn: () => api.getFlowEvaluationBaseline(flowId, taskId),
  });
}

function fetchAdvisorRemediationList(playbookId: string, executionId: string, taskId?: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.fetchAdvisorRemediations(playbookId, executionId, taskId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.advisorRemediations(playbookId, executionId, taskId),
    queryFn: () => api.fetchAdvisorRemediations(playbookId, executionId, taskId),
  });
}

function fetchFlowTriggerList(flowId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlowTriggers(flowId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.flowTriggers(flowId),
    queryFn: () => api.getFlowTriggers(flowId),
  });
}

function fetchFlowExecutionHistory(flowId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlowExecutions(flowId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.executions(flowId),
    queryFn: () => api.getFlowExecutions(flowId),
  });
}

function fetchFlowExecutionDetail(executionId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlowExecutionDetail(executionId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.execution(executionId),
    queryFn: () => api.getFlowExecutionDetail(executionId),
  });
}

function fetchPlaybookNodeTemplates() {
  if (!playbookFeatures.queryEnabled) {
    return api.getPlaybookNodeTemplates();
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.nodeTemplates(),
    queryFn: api.getPlaybookNodeTemplates,
  });
}

function fetchFlowNodeTemplateList() {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlowNodeTemplates();
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.templates(),
    queryFn: api.getFlowNodeTemplates,
  });
}

function fetchFlowNodeKindList() {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlowNodeKinds();
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.flowNodeKinds(),
    queryFn: api.getFlowNodeKinds,
  });
}

function fetchTaskReplayList(playbookId: string, taskId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getTaskReplays(playbookId, taskId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.replays(playbookId, taskId),
    queryFn: () => api.getTaskReplays(playbookId, taskId),
  });
}

function fetchFlowTaskReplayList(flowId: string, taskId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlowTaskReplays(flowId, taskId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.flowReplays(flowId, taskId),
    queryFn: () => api.getFlowTaskReplays(flowId, taskId),
  });
}

function fetchPlaybookRepeatability(playbookId: string, limit: number, offset: number) {
  if (!playbookFeatures.queryEnabled) {
    return api.getPlaybookRepeatability(playbookId, limit, offset);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.repeatability(playbookId, limit, offset),
    queryFn: () => api.getPlaybookRepeatability(playbookId, limit, offset),
  });
}

function fetchFlowRepeatabilitySummary(flowId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlowRepeatability(flowId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.flowRepeatability(flowId),
    queryFn: () => api.getFlowRepeatability(flowId),
  });
}

function fetchFlowTaskRepeatabilitySummary(flowId: string, taskId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlowTaskRepeatability(flowId, taskId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.flowTaskRepeatability(flowId, taskId),
    queryFn: () => api.getFlowTaskRepeatability(flowId, taskId),
  });
}

function fetchOutputFormatTemplateDetail(playbookId: string, taskId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getOutputFormatTemplate(playbookId, taskId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.outputFormatTemplate(playbookId, taskId),
    queryFn: () => api.getOutputFormatTemplate(playbookId, taskId),
  });
}

function fetchFlowOutputFormatTemplateDetail(flowId: string, taskId: string) {
  if (!playbookFeatures.queryEnabled) {
    return api.getFlowOutputFormatTemplate(flowId, taskId);
  }

  return playbookQueryClient.fetchQuery({
    queryKey: playbookKeys.flowOutputFormatTemplate(flowId, taskId),
    queryFn: () => api.getFlowOutputFormatTemplate(flowId, taskId),
  });
}

function invalidateTaskReplayReads(playbookId: string, taskId: string): void {
  void playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.replays(playbookId, taskId) });
}

function invalidateFlowTaskReplayReads(flowId: string, taskId: string): void {
  void playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.flowReplays(flowId, taskId) });
}

function invalidateOutputFormatTemplateRead(playbookId: string, taskId: string): void {
  void playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.outputFormatTemplate(playbookId, taskId) });
}

function invalidateFlowOutputFormatTemplateRead(flowId: string, taskId: string): void {
  void playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.flowOutputFormatTemplate(flowId, taskId) });
}

function logPlaybookPerfMetric(
  metric: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  if (import.meta.env.DEV) {
    console.info(`[playbook_perf] ${metric}`, fields);
  }
}

function getAutosaveRetryDelayMs(backoffUntil: number | null): number {
  if (!backoffUntil) {
    return 2000;
  }
  return Math.min(Math.max(backoffUntil - Date.now(), 2000) * 2, 15000);
}

function isDisabledDeltaPatchError(error: unknown): boolean {
  const apiError = parseApiError(error);
  const rawError = apiError.raw as {
    config?: { url?: string };
    response?: { data?: { error?: { message?: string } } };
  } | undefined;

  return apiError.code === 'ERR_1006'
    && apiError.statusCode === 400
    && rawError?.config?.url?.endsWith('/delta') === true
    && rawError?.response?.data?.error?.message === 'Playbook delta patch is disabled.';
}

function getChangedDefinitionFields(previous: UpdateFlowData, current: UpdateFlowData): Set<keyof UpdateFlowData> {
  const changed = new Set<keyof UpdateFlowData>();
  const fields: Array<keyof UpdateFlowData> = [
    'name',
    'description',
    'designSettings',
    'settings',
    'workspaces',
    'reflectionEnabled',
    'advisorScoringMode',
    'advisorAutopilotEnabled',
    'advisorAutopilotTargetScore',
    'advisorAutopilotMaxTurns',
    'nodes',
    'controlEdges',
    'dataBindings',
  ];

  for (const field of fields) {
    if (api.stableStringify(previous[field]) !== api.stableStringify(current[field])) {
      changed.add(field);
    }
  }

  return changed;
}

function hasOverlappingDefinitionChanges(
  base: UpdateFlowData,
  localDraft: UpdateFlowData,
  serverDraft: UpdateFlowData,
): boolean {
  const localChanges = getChangedDefinitionFields(base, localDraft);
  const serverChanges = getChangedDefinitionFields(base, serverDraft);
  for (const field of localChanges) {
    if (serverChanges.has(field)) {
      return true;
    }
  }
  return false;
}

function rebaseDefinitionChanges(
  base: UpdateFlowData,
  localDraft: UpdateFlowData,
  serverDraft: UpdateFlowData,
): UpdateFlowData {
  const rebased: UpdateFlowData = { ...serverDraft };
  for (const field of getChangedDefinitionFields(base, localDraft)) {
    rebased[field] = localDraft[field] as never;
  }
  return rebased;
}

function buildSavePayload(playbook: Playbook, options?: {
  expectedDefinitionRevision?: number;
  expectedUpdatedAt?: string;
  clientMutationId?: string;
  assistantOperationId?: string;
  assistantOperationTarget?: 'canonical' | 'advisor_preview';
}): UpdatePlaybookData {
  return {
    name: playbook.name,
    description: playbook.description,
    designSettings: playbook.designSettings,
    tasks: playbook.tasks,
    edges: playbook.edges,
    dataBindings: playbook.dataBindings,
    settings: playbook.settings,
    workspaces: playbook.workspaces,
    reflectionEnabled: playbook.reflectionEnabled,
    advisorScoringMode: playbook.advisorScoringMode,
    advisorAutopilotEnabled: playbook.advisorAutopilotEnabled,
    advisorAutopilotTargetScore: playbook.advisorAutopilotTargetScore ?? undefined,
    advisorAutopilotMaxTurns: playbook.advisorAutopilotMaxTurns ?? undefined,
    expectedDefinitionRevision: options?.expectedDefinitionRevision,
    expectedUpdatedAt: options?.expectedUpdatedAt,
    clientMutationId: options?.clientMutationId,
    assistantOperationId: options?.assistantOperationId,
    assistantOperationTarget: options?.assistantOperationTarget,
  };
}

function getPreferredSelectedStepId(
  taskResults: Array<{ taskId: string; status: string; order?: number | null }>,
  currentSelectedStepId: string | null,
): string | null {
  if (currentSelectedStepId && taskResults.some((tr) => tr.taskId === currentSelectedStepId)) {
    return currentSelectedStepId;
  }

  const sorted = [...taskResults].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const firstStep = sorted.find((tr) => tr.status === 'running') ?? sorted.find((tr) => tr.status === 'pending') ?? sorted[0];
  return firstStep?.taskId ?? null;
}

/** Status priority for smart merge — higher wins. */
const STATUS_PRIORITY: Record<string, number> = {
  pending: 0,
  queued: 0,
  running: 1,
  interrupted: 2,
  pending_approval: 2,
  completed: 3,
  failed: 3,
  skipped: 3,
  cancelled: 3,
};

function isActiveExecutionStatus(status: ExecutionStatus | string | null | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'interrupted' || status === 'pending_approval';
}

function isNewerStatus(a: string, b: string): boolean {
  return (STATUS_PRIORITY[a] ?? 0) > (STATUS_PRIORITY[b] ?? 0);
}

/** Evict oldest entries from the execution cache if it exceeds the limit. */
function evictCache(cache: Record<string, PlaybookExecution>): Record<string, PlaybookExecution> {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_EXECUTION_CACHE) return cache;
  const sorted = keys.sort((a, b) => (cache[a].updatedAt || '').localeCompare(cache[b].updatedAt || ''));
  const toRemove = sorted.slice(0, keys.length - MAX_EXECUTION_CACHE);
  const next = { ...cache };
  for (const k of toRemove) delete next[k];
  return next;
}

function clearTaskResultStaleState<T extends PlaybookExecution['taskResults'][number]>(taskResult: T): T {
  return {
    ...taskResult,
    isStale: false,
    staleReason: null,
    invalidatedByTaskId: null,
  };
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function updatePlaybookExecutionStatus(
  playbooks: PlaybookSummary[],
  playbookId: string,
  status: ExecutionStatus | null | undefined,
): PlaybookSummary[] {
  return playbooks.map((playbook) => (
    playbook.id === playbookId
      ? { ...playbook, executionStatus: status ?? null }
      : playbook
  ));
}

function shouldKeepRunningAttempt(
  cachedTaskResult: PlaybookExecution['taskResults'][number],
  incomingTaskResult: PlaybookExecution['taskResults'][number],
): boolean {
  if (cachedTaskResult.status !== 'running') {
    return false;
  }

  const cachedStartedAt = toTimestamp(cachedTaskResult.startedAt);
  const incomingStartedAt = toTimestamp(incomingTaskResult.startedAt);
  const incomingCompletedAt = toTimestamp(incomingTaskResult.completedAt);
  const incomingAttemptTimestamp = Math.max(incomingStartedAt, incomingCompletedAt);

  return cachedStartedAt > 0 && cachedStartedAt > incomingAttemptTimestamp;
}

function shouldKeepRunningExecution(
  cachedExecution: Pick<PlaybookExecution, 'status' | 'updatedAt' | 'startedAt' | 'completedAt'>,
  incomingExecution: Pick<PlaybookExecution, 'status' | 'updatedAt' | 'startedAt' | 'completedAt'>,
): boolean {
  if (cachedExecution.status !== 'running') {
    return false;
  }

  const cachedUpdatedAt = toTimestamp(cachedExecution.updatedAt);
  const cachedStartedAt = toTimestamp(cachedExecution.startedAt);
  const incomingUpdatedAt = toTimestamp(incomingExecution.updatedAt);
  const incomingStartedAt = toTimestamp(incomingExecution.startedAt);
  const incomingCompletedAt = toTimestamp(incomingExecution.completedAt);
  const cachedAttemptTimestamp = Math.max(cachedUpdatedAt, cachedStartedAt);
  const incomingAttemptTimestamp = Math.max(incomingUpdatedAt, incomingStartedAt, incomingCompletedAt);

  return cachedAttemptTimestamp > 0 && cachedAttemptTimestamp > incomingAttemptTimestamp;
}

const JUDGE_STATUS_PRIORITY: Record<string, number> = {
  idle: 0,
  evaluating: 1,
  evaluated: 2,
  failed: 2,
};

function hasRicherJudgeState(
  cachedTaskResult: PlaybookExecution['taskResults'][number],
  incomingTaskResult: PlaybookExecution['taskResults'][number],
): boolean {
  const cachedJudgePriority = JUDGE_STATUS_PRIORITY[cachedTaskResult.judgeStatus || 'idle'] ?? 0;
  const incomingJudgePriority = JUDGE_STATUS_PRIORITY[incomingTaskResult.judgeStatus || 'idle'] ?? 0;
  if (cachedJudgePriority > incomingJudgePriority) {
    return true;
  }

  if (cachedTaskResult.judgeResult && !incomingTaskResult.judgeResult) {
    return true;
  }

  return (cachedTaskResult.judgeHistory?.length || 0) > (incomingTaskResult.judgeHistory?.length || 0);
}

function getTaskResultCacheKey(taskResult: Pick<PlaybookExecution['taskResults'][number], 'taskId' | 'iteration'>): string {
  const normalizedIteration = taskResult.iteration === undefined || taskResult.iteration === 0
    ? 'base'
    : taskResult.iteration;
  return `${taskResult.taskId}::${normalizedIteration}`;
}

function iterationsMatch(a: number | undefined, b: number | undefined): boolean {
  return (a ?? 0) === (b ?? 0);
}

function buildAncestorTaskIdSet(
  graphSource: Pick<Playbook, 'edges'> | Pick<PlaybookExecution, 'playbookSnapshot'> | null,
  taskId: string,
): Set<string> {
  let edges: PlaybookEdge[] = [];
  if (graphSource) {
    if ('playbookSnapshot' in graphSource) {
      edges = ((graphSource.playbookSnapshot as { edges?: PlaybookEdge[] } | null)?.edges || []);
    } else {
      edges = graphSource.edges || [];
    }
  }

  if (edges.length === 0) {
    return new Set();
  }

  const ancestors = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const currentTaskId = queue.shift()!;
    for (const edge of edges) {
      const sourceId = edge.sourceId;
      const targetId = edge.targetId;
      if (targetId !== currentTaskId || !sourceId || ancestors.has(sourceId)) {
        continue;
      }
      ancestors.add(sourceId);
      queue.push(sourceId);
    }
  }

  return ancestors;
}

function normalizeRunningTaskResultsForStart(
  taskResults: PlaybookExecution['taskResults'],
  startedTaskId: string,
  graphSource: Pick<Playbook, 'edges'> | Pick<PlaybookExecution, 'playbookSnapshot'> | null,
): PlaybookExecution['taskResults'] {
  const ancestorTaskIds = buildAncestorTaskIdSet(graphSource, startedTaskId);

  return taskResults.map((taskResult) => {
    if (taskResult.taskId === startedTaskId) {
      return taskResult;
    }

    if (taskResult.status !== 'running') {
      return taskResult;
    }

    if (!ancestorTaskIds.has(taskResult.taskId)) {
      return taskResult;
    }

    return {
      ...taskResult,
      status: 'completed',
      completedAt: taskResult.completedAt || new Date().toISOString(),
      durationMs: taskResult.durationMs ?? null,
    };
  });
}

function mergeIteratorChildTaskResult(
  taskResults: PlaybookExecution['taskResults'],
  data: {
    parentIteratorId: string;
    iterationIndex: number;
    taskId: string;
    taskTitle?: string;
    status: 'running' | 'completed' | 'failed' | 'skipped';
    output?: string | null;
    error?: string | null;
    components?: PlaybookExecution['taskResults'][number]['components'];
    toolTrace?: PlaybookExecution['taskResults'][number]['toolTrace'];
    reasoningChain?: PlaybookExecution['taskResults'][number]['reasoningChain'];
    llmPromptTrace?: PlaybookExecution['taskResults'][number]['llmPromptTrace'];
    artifacts?: PlaybookExecution['taskResults'][number]['artifacts'];
  },
): PlaybookExecution['taskResults'] {
  const resolveIterationStatus = (
    childResults: NonNullable<PlaybookExecution['taskResults'][number]['iteratorIterations']>[number]['childResults'],
  ): 'running' | 'completed' | 'failed' | 'skipped' => {
    if (childResults.some((child) => child.status === 'running' || child.status === 'interrupted')) {
      return 'running';
    }
    if (childResults.some((child) => child.status === 'failed')) {
      return 'failed';
    }
    if (childResults.length > 0 && childResults.every((child) => child.status === 'skipped')) {
      return 'skipped';
    }
    return 'completed';
  };

  return taskResults.map((taskResult) => {
    if (taskResult.taskId !== data.parentIteratorId) {
      return taskResult;
    }

    const iteratorIterations = [...(taskResult.iteratorIterations || [])];
    const currentIteration = iteratorIterations.find((iteration) => iteration.index === data.iterationIndex);
    const nextIteration = currentIteration
      ? { ...currentIteration }
      : {
          index: data.iterationIndex,
          status: 'running' as const,
          itemPreview: null,
          output: null,
          error: null,
          childResults: [],
          artifacts: [],
        };

    const existingChildIndex = nextIteration.childResults.findIndex((child) => child.taskId === data.taskId);
    const existingChild = existingChildIndex >= 0 ? nextIteration.childResults[existingChildIndex] : null;
    const mergedChild = {
      taskId: data.taskId,
      taskTitle: data.taskTitle || existingChild?.taskTitle || '',
      status: data.status,
      output: data.output ?? existingChild?.output ?? null,
      error: data.error ?? existingChild?.error ?? null,
      components: data.components ?? existingChild?.components,
      toolTrace: data.toolTrace ?? existingChild?.toolTrace,
      reasoningChain: data.reasoningChain ?? existingChild?.reasoningChain,
      llmPromptTrace: data.llmPromptTrace ?? existingChild?.llmPromptTrace,
      artifacts: data.artifacts ?? existingChild?.artifacts,
    };

    const childResults = [...nextIteration.childResults];
    if (existingChildIndex >= 0) {
      childResults[existingChildIndex] = mergedChild;
    } else {
      childResults.push(mergedChild);
    }

    nextIteration.childResults = childResults;
    nextIteration.status = resolveIterationStatus(childResults);

    const iterationIndexInArray = iteratorIterations.findIndex((iteration) => iteration.index === data.iterationIndex);
    if (iterationIndexInArray >= 0) {
      iteratorIterations[iterationIndexInArray] = nextIteration;
    } else {
      iteratorIterations.push(nextIteration);
      iteratorIterations.sort((left, right) => left.index - right.index);
    }

    return {
      ...taskResult,
      iteratorIterations,
    };
  });
}

function hasRicherIteratorData(
  cachedTaskResult: PlaybookExecution['taskResults'][number],
  incomingTaskResult: PlaybookExecution['taskResults'][number],
): boolean {
  const cachedIterations = cachedTaskResult.iteratorIterations || [];
  const incomingIterations = incomingTaskResult.iteratorIterations || [];
  if (cachedIterations.length === 0) return false;
  if (incomingIterations.length === 0) return true;
  const cachedTotalChildren = cachedIterations.reduce((sum, it) => sum + (it.childResults?.length || 0), 0);
  const incomingTotalChildren = incomingIterations.reduce((sum, it) => sum + (it.childResults?.length || 0), 0);
  return cachedTotalChildren > incomingTotalChildren;
}

function mergeRicherIteratorData(
  cachedTaskResult: PlaybookExecution['taskResults'][number],
  incomingTaskResult: PlaybookExecution['taskResults'][number],
): PlaybookExecution['taskResults'][number] {
  if (!hasRicherIteratorData(cachedTaskResult, incomingTaskResult)) {
    return incomingTaskResult;
  }

  return {
    ...incomingTaskResult,
    iteratorIterations: cachedTaskResult.iteratorIterations,
  };
}

function mergeHitlHistory(
  cached: PlaybookExecution['hitlHistory'],
  incoming: PlaybookExecution['hitlHistory'],
): PlaybookExecution['hitlHistory'] {
  const cachedHistory = cached || [];
  const incomingHistory = incoming || [];
  if (cachedHistory.length === 0) {
    return incomingHistory;
  }
  if (incomingHistory.length === 0) {
    return cachedHistory;
  }

  const incomingByInterruptId = new Map(
    incomingHistory.map((entry) => [entry.interruptId, entry]),
  );
  const mergedByIncomingOrder = incomingHistory.map((incomingEntry) => {
    const cachedEntry = cachedHistory.find((entry) => entry.interruptId === incomingEntry.interruptId);
    if (!cachedEntry) {
      return incomingEntry;
    }
    return cachedEntry.status === 'answered' || incomingEntry.status === 'pending' ? cachedEntry : incomingEntry;
  });

  const missingCached = cachedHistory.filter(
    (entry) => !incomingByInterruptId.has(entry.interruptId),
  );
  return [...mergedByIncomingOrder, ...missingCached];
}

function shouldKeepCachedTaskResult(
  cachedTaskResult: PlaybookExecution['taskResults'][number],
  incomingTaskResult: PlaybookExecution['taskResults'][number],
): boolean {
  if (shouldKeepRunningAttempt(cachedTaskResult, incomingTaskResult)) {
    return true;
  }

  if (incomingTaskResult.isStale && !cachedTaskResult.isStale) {
    return true;
  }

  if (
    incomingTaskResult.isStale
    && (cachedTaskResult.status === 'running' || cachedTaskResult.status === 'pending')
  ) {
    return true;
  }

  if (
    cachedTaskResult.status === incomingTaskResult.status
    && hasRicherJudgeState(cachedTaskResult, incomingTaskResult)
  ) {
    return true;
  }

  return isNewerStatus(cachedTaskResult.status, incomingTaskResult.status);
}

function buildResumeFromStepTaskResults(taskResults: PlaybookExecution['taskResults'], taskId: string) {
  const sorted = [...taskResults].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const startIndex = sorted.findIndex((taskResult) => taskResult.taskId === taskId);
  if (startIndex === -1) {
    return taskResults;
  }

  const downstreamTaskIds = new Set(sorted.slice(startIndex).map((taskResult) => taskResult.taskId));
  const now = new Date().toISOString();

  return taskResults.map((taskResult) => {
    if (!downstreamTaskIds.has(taskResult.taskId)) {
      return taskResult;
    }

    const cleared = clearTaskResultStaleState(taskResult);
    if (taskResult.taskId === taskId) {
      return {
        ...cleared,
        status: 'running' as const,
        output: null,
        error: null,
        durationMs: null,
        startedAt: now,
        completedAt: null,
        components: [],
        toolTrace: [],
        llmPromptTrace: [],
        artifacts: [],
        semanticMatch: null,
        judgeStatus: 'idle' as const,
        judgeResult: null,
        judgeError: null,
      };
    }

    return {
      ...cleared,
      status: 'pending' as const,
      output: null,
      error: null,
      durationMs: null,
      startedAt: null,
      completedAt: null,
      semanticMatch: null,
      judgeStatus: 'idle' as const,
      judgeResult: null,
      judgeError: null,
      judgeHistory: taskResult.judgeHistory || [],
      evaluationHistory: taskResult.evaluationHistory || [],
      stepExecutions: taskResult.stepExecutions || [],
    };
  });
}

function buildRerunStepTaskResults(taskResults: PlaybookExecution['taskResults'], taskId: string) {
  const now = new Date().toISOString();

  return taskResults.map((taskResult) => {
    if (taskResult.taskId !== taskId) {
      return taskResult;
    }

    return {
      ...clearTaskResultStaleState(taskResult),
      status: 'running' as const,
      output: null,
      error: null,
      durationMs: null,
      startedAt: now,
      completedAt: null,
      components: [],
      toolTrace: [],
      llmPromptTrace: [],
      artifacts: [],
      semanticMatch: null,
      judgeStatus: 'idle' as const,
      judgeResult: null,
      judgeError: null,
    };
  });
}

function buildExecutionTaskResultsFromTasks(
  tasks: PlaybookTask[],
  options?: { runningTaskId?: string | null; markAllPending?: boolean },
): PlaybookExecution['taskResults'] {
  const sortedTasks = [...tasks].sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0));
  const runningTaskId = options?.markAllPending ? null : (options?.runningTaskId ?? null);

  return sortedTasks.map((task, index) => ({
    taskId: task.id,
    nodeTitle: task.title || '',
    agentName: '',
    order: task.executionOrder ?? index,
    status: task.id === runningTaskId ? 'running' : 'pending',
    output: null,
    error: null,
    durationMs: null,
    startedAt: task.id === runningTaskId ? new Date().toISOString() : null,
    completedAt: null,
    isStale: false,
    staleReason: null,
    invalidatedByTaskId: null,
    semanticMatch: null,
    judgeStatus: 'idle' as const,
    judgeResult: null,
    judgeError: null,
    judgeHistory: [],
    evaluationHistory: [],
    stepExecutions: [],
    iteratorIterations: [],
  } as PlaybookExecution['taskResults'][number]));
}

function buildReplayTaskIdSet(playbook: Playbook, targetTaskId: string): Set<string> {
  const taskIds = new Set(playbook.tasks.map((task) => task.id));
  const adjacency = new Map<string, string[]>();

  for (const controlEdge of playbook.controlEdges || []) {
    if (!taskIds.has(controlEdge.source) || !taskIds.has(controlEdge.target)) {
      continue;
    }
    const next = adjacency.get(controlEdge.source) || [];
    next.push(controlEdge.target);
    adjacency.set(controlEdge.source, next);
  }

  if (adjacency.size === 0) {
    for (const edge of playbook.edges) {
      if (!taskIds.has(edge.sourceId) || !taskIds.has(edge.targetId)) {
        continue;
      }
      const next = adjacency.get(edge.sourceId) || [];
      next.push(edge.targetId);
      adjacency.set(edge.sourceId, next);
    }
  }

  const replayTaskIds = new Set<string>([targetTaskId]);
  const stack = [...(adjacency.get(targetTaskId) || [])];
  while (stack.length > 0) {
    const taskId = stack.pop();
    if (!taskId || replayTaskIds.has(taskId)) {
      continue;
    }
    replayTaskIds.add(taskId);
    stack.push(...(adjacency.get(taskId) || []));
  }

  return replayTaskIds;
}

function buildReplayTaskResultsFromSource(
  sourceExecution: PlaybookExecution,
  playbook: Playbook,
  targetTaskId: string,
): PlaybookExecution['taskResults'] {
  const sortedTasks = [...playbook.tasks].sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0));
  const replayTaskIds = buildReplayTaskIdSet(playbook, targetTaskId);
  if (!replayTaskIds.has(targetTaskId)) {
    return buildExecutionTaskResultsFromTasks(playbook.tasks, { runningTaskId: targetTaskId });
  }

  const latestResultByTaskId = new Map<string, PlaybookExecution['taskResults'][number]>();
  for (const taskResult of sourceExecution.taskResults) {
    latestResultByTaskId.set(taskResult.taskId, taskResult);
  }

  return sortedTasks.map((task, index) => {
    const previous = latestResultByTaskId.get(task.id);
    if (!replayTaskIds.has(task.id) && previous) {
      return previous;
    }
    if (task.id === targetTaskId) {
      return previous
        ? {
            ...clearTaskResultStaleState(previous),
            status: 'running' as const,
            output: null,
            error: null,
            durationMs: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
            components: [],
            toolTrace: [],
            llmPromptTrace: [],
            artifacts: [],
            semanticMatch: null,
            judgeStatus: 'idle' as const,
            judgeResult: null,
            judgeError: null,
          }
        : buildExecutionTaskResultsFromTasks(playbook.tasks, { runningTaskId: targetTaskId })[index];
    }
    return {
      taskId: task.id,
      nodeTitle: task.title || '',
      agentName: previous?.agentName || '',
      order: task.executionOrder ?? index,
      status: 'pending',
      output: null,
      error: null,
      durationMs: null,
      startedAt: null,
      completedAt: null,
      isStale: false,
      staleReason: null,
      invalidatedByTaskId: null,
      semanticMatch: null,
      judgeStatus: 'idle' as const,
      judgeResult: null,
      judgeError: null,
      judgeHistory: [],
      evaluationHistory: [],
      stepExecutions: [],
      iteratorIterations: [],
    } as PlaybookExecution['taskResults'][number];
  });
}

function mergeReplayTaskResults(
  replayExecution: PlaybookExecution,
  sourceExecution: PlaybookExecution,
  playbook: Playbook,
): PlaybookExecution['taskResults'] {
  const replaySource = replayExecution.replaySource;
  if (!replaySource?.taskId) {
    return replayExecution.taskResults;
  }

  const hydratedTaskResults = buildReplayTaskResultsFromSource(sourceExecution, playbook, replaySource.taskId);
  const replayResultMap = new Map(replayExecution.taskResults.map((taskResult) => [getTaskResultCacheKey(taskResult), taskResult]));

  return hydratedTaskResults.map((taskResult) => replayResultMap.get(getTaskResultCacheKey(taskResult)) ?? taskResult);
}

async function hydrateReplayExecutionFromSource(
  replayExecution: PlaybookExecution,
  playbookId: string,
  playbook: Playbook | null,
  executionCache: Record<string, PlaybookExecution>,
): Promise<PlaybookExecution> {
  const replaySource = replayExecution.replaySource;
  if (!replaySource?.executionId || !replaySource.taskId) {
    return replayExecution;
  }

  let resolvedPlaybook = playbook;
  if (!resolvedPlaybook) {
    try {
      resolvedPlaybook = await fetchLegacyPlaybookDetail(playbookId);
    } catch {
      resolvedPlaybook = null;
    }
  }
  if (!resolvedPlaybook) {
    return replayExecution;
  }

  let sourceExecution: PlaybookExecution | null = executionCache[replaySource.executionId] ?? null;
  if (!sourceExecution) {
    try {
      sourceExecution = await fetchPlaybookExecutionDetail(playbookId, replaySource.executionId);
    } catch {
      sourceExecution = null;
    }
  }
  if (!sourceExecution) {
    return replayExecution;
  }

  return {
    ...replayExecution,
    taskResults: mergeReplayTaskResults(replayExecution, sourceExecution, resolvedPlaybook),
  };
}

// ===== Store Implementation =====

const createPlaybookStore: StateCreator<PlaybookStore> = (set, get) => ({
      ...initialState,

      // ===== CRUD =====

      fetchPlaybooks: async (query) => {
        if (get().playbooksLoading) return;
        const mergedQuery: PlaybookQueryParams = { page: 1, limit: 20, ...query };
        set({ playbooksLoading: true, error: null, playbooksQuery: mergedQuery });
        try {
          const result = await fetchPlaybookList(mergedQuery);
          set({ playbooks: result.playbooks, playbooksPagination: result.pagination, playbooksLoading: false });
        } catch (err) {
          const msg = err instanceof Error ? err.message : tPlaybook('store.errors.fetchFailed', 'Failed to fetch playbooks');
          set({ playbooksLoading: false, error: msg });
        }
      },

      fetchMorePlaybooks: async () => {
        const { playbooksPagination, playbooksLoading, playbooksQuery } = get();
        if (playbooksLoading || !playbooksPagination) return;
        if (playbooksPagination.page >= playbooksPagination.totalPages) return;
        set({ playbooksLoading: true });
        try {
          const nextPage = playbooksPagination.page + 1;
          const result = await fetchPlaybookList({ ...playbooksQuery, page: nextPage, limit: playbooksPagination.limit });
          set((state) => ({
            playbooks: [...state.playbooks, ...result.playbooks],
            playbooksPagination: result.pagination,
            playbooksLoading: false,
          }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : tPlaybook('store.errors.fetchFailed', 'Failed to fetch playbooks');
          set({ playbooksLoading: false, error: msg });
        }
      },

      fetchPlaybook: async (id) => {
        set({ currentPlaybookLoading: true, error: null });
        try {
          const { currentPlaybook, undoStack, redoStack, perPlaybookUndoHistory } = get();
          if (currentPlaybook) {
            perPlaybookUndoHistory[currentPlaybook.id] = { undoStack, redoStack };
          }
          const restored = perPlaybookUndoHistory[id] ?? { undoStack: [], redoStack: [] };
          const playbook = await fetchLegacyPlaybookDetail(id);
          const baselineRequestBody = api.buildPlaybookBaselineRequestBody(buildSavePayload(playbook)) as UpdateFlowData;
          const baselineTelemetry = api.getPlaybookUpdateTelemetry(buildSavePayload(playbook));
          set((state) => ({
            currentPlaybook: playbook,
            currentPlaybookLoading: false,
            isDirty: false,
            undoStack: restored.undoStack,
            redoStack: restored.redoStack,
            perPlaybookUndoHistory,
            canvasSyncVersion: 0,
            lastSavedPayloadHashByPlaybookId: {
              ...state.lastSavedPayloadHashByPlaybookId,
              [playbook.id]: baselineTelemetry.payloadHash,
            },
            lastSavedRequestBodyByPlaybookId: {
              ...state.lastSavedRequestBodyByPlaybookId,
              [playbook.id]: baselineRequestBody,
            },
          }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : tPlaybook('store.errors.fetchOneFailed', 'Failed to fetch playbook');
          set({ currentPlaybookLoading: false, error: msg });
        }
      },

      createPlaybook: async (data) => {
        const playbook = playbookFeatures.queryMutationsEnabled
          ? await createPlaybookMutation(data)
          : await api.createPlaybook(data);
        const summary: PlaybookSummary = {
          id: playbook.id,
          name: playbook.name,
          description: playbook.description,
          taskCount: (playbook.tasks ?? playbook.nodes ?? []).length,
          isFavorite: playbook.isFavorite,
          scheduleEnabled: playbook.executionSchedule?.enabled === true,
          executionStatus: null,
          lastExecutionAt: null,
          createdAt: playbook.createdAt,
          updatedAt: playbook.updatedAt,
        };
        set((state) => ({ playbooks: [summary, ...state.playbooks] }));
        toast.success(tPlaybook('store.toasts.created', 'Playbook created'));
        return playbook;
      },

      generatePlaybook: async (data: GeneratePlaybookData) => {
        const { currentPlaybook: currentPb, undoStack, redoStack, perPlaybookUndoHistory: pbHistory } = get();
        if (currentPb) {
          pbHistory[currentPb.id] = { undoStack, redoStack };
        }
        set({ isGenerating: true, currentPlaybook: null, currentPlaybookLoading: false, generateRetryData: null, undoStack: [], redoStack: [], perPlaybookUndoHistory: pbHistory, canvasSyncVersion: 0 });
        try {
          const result = await api.generatePlaybook(data);
          const playbook = await fetchLegacyPlaybookDetail(result.id);
          const layoutedTasks = autoLayoutTasks(playbook.tasks, playbook.edges);
          const layoutedPlaybook = { ...playbook, tasks: layoutedTasks };
          set({ currentPlaybook: layoutedPlaybook, isGenerating: false, isDirty: true });
          get().fetchPlaybooks();
          toast.success(tPlaybook('store.toasts.generated', 'Playbook generated'));
          return result.id;
        } catch (err) {
          set({ isGenerating: false, generateRetryData: data });
          throw err;
        }
      },

      clearGenerateRetry: () => set({ generateRetryData: null }),

      updatePlaybook: async (id, data) => {
        const requestId = get().saveRequestId + 1;
        const saveStartDirtyVersion = get().dirtyVersion;
        const saveStartedAt = performance.now();
        const effectiveData = {
          ...data,
          expectedDefinitionRevision: data.expectedDefinitionRevision ?? get().currentPlaybook?.definitionRevision,
        };
        const requestBody = api.buildPlaybookBaselineRequestBody(effectiveData) as UpdateFlowData;
        const payloadTelemetry = api.getPlaybookUpdateTelemetry(effectiveData);
        let savedRequestBody = requestBody;
        let savedPayloadHash = payloadTelemetry.payloadHash;
        const previousRequestBody = get().lastSavedRequestBodyByPlaybookId[id];
        const expectedDefinitionRevision = effectiveData.expectedDefinitionRevision;
        const deltaPatch = deltaAutosaveAvailableInSession
          && !effectiveData.assistantOperationId
          && previousRequestBody
          && expectedDefinitionRevision !== undefined
          ? api.buildPlaybookDeltaPatch(previousRequestBody, requestBody, {
            expectedDefinitionRevision,
            payloadHash: payloadTelemetry.payloadHash,
            basePayloadHash: get().lastSavedPayloadHashByPlaybookId[id],
            clientMutationId: data.clientMutationId,
          })
          : null;
        let effectiveSaveMode: 'delta' | 'full' = deltaPatch ? 'delta' : 'full';
        set({
          isSaving: true,
          saveRequestId: requestId,
          savingDirtyVersion: saveStartDirtyVersion,
        });
        try {
          let playbook: Playbook;
          const saveDirectly = async (saveData: UpdatePlaybookData): Promise<Playbook> => (
            playbookFeatures.queryMutationsEnabled
              ? updatePlaybookMutation({ id, data: saveData })
              : api.updatePlaybook(id, saveData)
          );

          const saveWithCurrentMode = async (): Promise<Playbook> => {
            if (!deltaPatch) {
              return saveDirectly(effectiveData);
            }

            try {
              const saveDelta = playbookFeatures.queryMutationsEnabled
                ? patchFlowDeltaMutation({ id, data: deltaPatch })
                : api.patchFlowDelta(id, deltaPatch);
              return await saveDelta.then(async (result) => {
                const current = get().currentPlaybook;
                if (!current || current.id !== id) {
                  throw new Error('Playbook state changed during delta save.');
                }
                return {
                  ...current,
                  definitionRevision: result.definitionRevision,
                  updatedAt: result.updatedAt,
                };
              });
            } catch (err) {
              if (!isDisabledDeltaPatchError(err)) {
                throw err;
              }
              // Only the explicit feature-disabled response is safe to replay as a full save.
              // Validation failures mean the backend rejected this graph shape.
              deltaAutosaveAvailableInSession = false;
              effectiveSaveMode = 'full';
              return saveDirectly(effectiveData);
            }
          };

          try {
            playbook = await saveWithCurrentMode();
          } catch (err) {
            const apiError = parseApiError(err);
            const latestState = get();
            const currentDraft = latestState.currentPlaybook;
            const isAutosaveConflict = latestState.lastSaveReason === 'autosave'
              && apiError.code === 'ERR_1005'
              && previousRequestBody
              && currentDraft
              && currentDraft.id === id;

            if (!isAutosaveConflict) {
              throw err;
            }

            const latestFlow = normalizePlaybook(await fetchPlaybookDetail(id, 'base') as any);
            const latestServerBody = api.buildPlaybookBaselineRequestBody(buildSavePayload(latestFlow)) as UpdateFlowData;
            const localDraftBody = api.buildPlaybookBaselineRequestBody(buildSavePayload(currentDraft)) as UpdateFlowData;

            if (hasOverlappingDefinitionChanges(previousRequestBody, localDraftBody, latestServerBody)) {
              throw err;
            }

            const rebasedPayload = {
              ...rebaseDefinitionChanges(previousRequestBody, localDraftBody, latestServerBody),
              expectedDefinitionRevision: latestFlow.definitionRevision,
              clientMutationId: effectiveData.clientMutationId,
            } as UpdatePlaybookData;
            effectiveSaveMode = 'full';
            savedRequestBody = api.buildPlaybookBaselineRequestBody(rebasedPayload) as UpdateFlowData;
            savedPayloadHash = api.getPlaybookUpdateTelemetry(rebasedPayload).payloadHash;
            playbook = await saveDirectly(rebasedPayload);
          }

          if (effectiveSaveMode === 'full') {
            savedRequestBody = api.buildPlaybookBaselineRequestBody(buildSavePayload(playbook)) as UpdateFlowData;
            savedPayloadHash = api.getPlaybookUpdateTelemetry(buildSavePayload(playbook)).payloadHash;
          }

          const existing = get().playbooks.find((p) => p.id === id);
          const summary: PlaybookSummary = {
            id: playbook.id,
            name: playbook.name,
            description: playbook.description,
            definitionRevision: playbook.definitionRevision,
            taskCount: (playbook.tasks ?? playbook.nodes ?? []).length,
            isFavorite: existing?.isFavorite ?? false,
            scheduleEnabled: playbook.executionSchedule?.enabled === true,
            executionStatus: existing?.executionStatus ?? null,
            lastExecutionAt: existing?.lastExecutionAt ?? null,
            createdAt: playbook.createdAt,
            updatedAt: playbook.updatedAt,
          };
          const latestState = get();
          const isLatestSaveRequest = latestState.saveRequestId === requestId;
          const hasNewerLocalChanges = latestState.dirtyVersion !== saveStartDirtyVersion;
          const saveDurationMs = Math.round(performance.now() - saveStartedAt);

          set((state) => ({
            playbooks: state.playbooks.map((p) => (p.id === id ? summary : p)),
            currentPlaybook: state.currentPlaybook?.id !== id
              ? state.currentPlaybook
              : {
                ...playbook,
                definitionRevision: playbook.definitionRevision,
                name: hasNewerLocalChanges
                  ? state.currentPlaybook.name
                  : playbook.name,
                description: hasNewerLocalChanges
                  ? state.currentPlaybook.description
                  : playbook.description,
                designSettings: hasNewerLocalChanges
                  ? state.currentPlaybook.designSettings
                  : playbook.designSettings,
                settings: hasNewerLocalChanges
                  ? state.currentPlaybook.settings
                  : playbook.settings,
                workspaces: hasNewerLocalChanges
                  ? state.currentPlaybook.workspaces
                  : playbook.workspaces,
                tasks: hasNewerLocalChanges
                  ? state.currentPlaybook.tasks
                  : playbook.tasks,
                edges: hasNewerLocalChanges
                  ? state.currentPlaybook.edges
                  : playbook.edges,
                dataBindings: hasNewerLocalChanges
                  ? state.currentPlaybook.dataBindings
                  : playbook.dataBindings,
                reflectionEnabled: hasNewerLocalChanges
                  ? state.currentPlaybook.reflectionEnabled
                  : playbook.reflectionEnabled,
                advisorScoringMode: hasNewerLocalChanges
                  ? state.currentPlaybook.advisorScoringMode
                  : playbook.advisorScoringMode,
                advisorAutopilotEnabled: hasNewerLocalChanges
                  ? state.currentPlaybook.advisorAutopilotEnabled
                  : playbook.advisorAutopilotEnabled,
                advisorAutopilotTargetScore: hasNewerLocalChanges
                  ? state.currentPlaybook.advisorAutopilotTargetScore
                  : playbook.advisorAutopilotTargetScore,
                advisorAutopilotMaxTurns: hasNewerLocalChanges
                  ? state.currentPlaybook.advisorAutopilotMaxTurns
                  : playbook.advisorAutopilotMaxTurns,
              },
            isDirty: hasNewerLocalChanges ? state.isDirty : false,
            isSaving: isLatestSaveRequest ? false : state.isSaving,
            savingDirtyVersion: isLatestSaveRequest ? null : state.savingDirtyVersion,
            pendingAutosaveAfterCurrent: isLatestSaveRequest ? false : state.pendingAutosaveAfterCurrent,
            autosaveBackoffUntil: latestState.lastSaveReason === 'autosave'
              ? null
              : state.autosaveBackoffUntil,
            lastAutosaveDurationMs: latestState.lastSaveReason === 'autosave' ? saveDurationMs : state.lastAutosaveDurationMs,
            lastSavedPayloadHashByPlaybookId: {
              ...state.lastSavedPayloadHashByPlaybookId,
              [id]: savedPayloadHash,
            },
            lastSavedRequestBodyByPlaybookId: {
              ...state.lastSavedRequestBodyByPlaybookId,
              [id]: savedRequestBody,
            },
          }));
          logPlaybookPerfMetric('playbook_autosave_payload_bytes', {
            mode: effectiveSaveMode,
            playbookId: id,
            payloadBytes: effectiveSaveMode === 'delta'
              ? api.measureSerializedBytes(deltaPatch)
              : payloadTelemetry.payloadBytes,
            reason: latestState.lastSaveReason,
          });
          if (isLatestSaveRequest && latestState.pendingAutosaveAfterCurrent && hasNewerLocalChanges) {
            void Promise.resolve().then(() => get().saveCurrentPlaybook({ reason: 'autosave' }));
          }
        } catch (err) {
          const latestState = get();
          const apiError = parseApiError(err);
          if (latestState.saveRequestId === requestId) {
            const autosaveFailed = latestState.lastSaveReason === 'autosave';
            const nextBackoffMs = autosaveFailed ? getAutosaveRetryDelayMs(latestState.autosaveBackoffUntil) : null;
            set({
              isSaving: false,
              savingDirtyVersion: null,
              autosaveBackoffUntil: autosaveFailed && nextBackoffMs
                ? Date.now() + nextBackoffMs
                : latestState.autosaveBackoffUntil,
            });
          }
          if (
            err &&
            typeof err === 'object' &&
            'statusCode' in err &&
            (err.statusCode === 401 || err.statusCode === 403)
          ) {
            return;
          }
          if (
            err && typeof err === 'object' && 'code' in err
            && (err as { code: string }).code === 'ERR_2533'
          ) {
            const dedupedName = `${data.name} (Imported)`;
            set((state) => ({
              currentPlaybook: state.currentPlaybook?.id === id
                ? { ...state.currentPlaybook, name: dedupedName }
                : state.currentPlaybook,
            }));
            toast.error(tPlaybook('store.errors.duplicateName', 'A playbook with this name already exists. Renamed to "{{name}}".', { name: dedupedName }));
            return;
          }
          if (
            latestState.lastSaveReason === 'autosave'
            && err
            && typeof err === 'object'
            && 'statusCode' in err
            && ((err as { statusCode?: number }).statusCode === 429 || (err as { statusCode?: number }).statusCode === 503)
          ) {
            toast.warning(tPlaybook('store.toasts.autosaveRetrying', 'Autosave is backing off and will retry shortly'));
            return;
          }
          if (latestState.lastSaveReason !== 'autosave' && apiError.code === ErrorCode.CONFLICT) {
            throw err;
          }
          const msg = err instanceof Error ? err.message : tPlaybook('store.errors.updateFailed', 'Failed to save');
          toast.error(msg);
        }
      },

      deletePlaybook: async (id) => {
        const previous = get().playbooks;
        set((state) => ({ playbooks: state.playbooks.filter((p) => p.id !== id) }));
        try {
          if (playbookFeatures.queryMutationsEnabled) {
            await deletePlaybookMutation(id);
          } else {
            await api.deletePlaybook(id);
          }
          toast.success(tPlaybook('store.toasts.deleted', 'Playbook deleted'));
        } catch {
          set({ playbooks: previous });
          toast.error(tPlaybook('store.errors.deleteFailed', 'Failed to delete playbook'));
        }
      },

      clonePlaybook: async (id) => {
        const cloned = playbookFeatures.queryMutationsEnabled
          ? await clonePlaybookMutation(id)
          : await api.clonePlaybook(id);
        const summary: PlaybookSummary = {
          id: cloned.id,
          name: cloned.name,
          description: cloned.description,
          taskCount: (cloned.tasks ?? cloned.nodes ?? []).length,
          isFavorite: cloned.isFavorite,
          scheduleEnabled: cloned.executionSchedule?.enabled === true,
          executionStatus: null,
          lastExecutionAt: null,
          createdAt: cloned.createdAt,
          updatedAt: cloned.updatedAt,
        };

        set((state) => ({
          playbooks: [summary, ...state.playbooks],
        }));

        toast.success(tPlaybook('store.toasts.cloned', 'Playbook cloned'));
        return cloned;
      },

      upsertPlaybookTriggerSchedule: async (playbookId: string, data: UpsertPlaybookScheduleData) => {
        set({ triggerSaving: true, triggerError: null });
        try {
          const pb = await api.upsertPlaybookTriggerSchedule(playbookId, data);
          const scheduleEnabled = pb.executionSchedule?.enabled === true;
          set((state) => ({
            triggerSaving: false,
            currentPlaybook:
              state.currentPlaybook?.id === playbookId
                ? {
                    ...state.currentPlaybook,
                    executionSchedule: pb.executionSchedule,
                    triggers: pb.triggers,
                    automatedTriggerType: pb.automatedTriggerType,
                  }
                : state.currentPlaybook,
            playbooks: state.playbooks.some((p) => p.id === playbookId)
              ? state.playbooks.map((p) =>
                p.id === playbookId
                  ? { ...p, scheduleEnabled, automatedTriggerType: pb.automatedTriggerType }
                  : p,
              )
              : state.playbooks,
          }));
          toast.success(tPlaybook('store.toasts.scheduleSaved', 'Schedule saved'));
        } catch (err) {
          set({ triggerSaving: false, triggerError: parseApiError(err).message });
          handleApiError(err);
          throw err;
        }
      },

      clearPlaybookTriggerSchedule: async (playbookId: string) => {
        set({ triggerSaving: true, triggerError: null });
        try {
          const pb = await api.clearPlaybookTriggerSchedule(playbookId);
          set((state) => ({
            triggerSaving: false,
            currentPlaybook:
              state.currentPlaybook?.id === playbookId
                ? {
                    ...state.currentPlaybook,
                    executionSchedule: pb.executionSchedule,
                    triggers: pb.triggers,
                    automatedTriggerType: pb.automatedTriggerType,
                  }
                : state.currentPlaybook,
            playbooks: state.playbooks.some((p) => p.id === playbookId)
              ? state.playbooks.map((p) =>
                p.id === playbookId
                  ? { ...p, scheduleEnabled: false, automatedTriggerType: null }
                  : p,
              )
              : state.playbooks,
          }));
          toast.success(tPlaybook('store.toasts.scheduleCleared', 'Schedule removed'));
        } catch (err) {
          set({ triggerSaving: false, triggerError: parseApiError(err).message });
          handleApiError(err);
          throw err;
        }
      },

      upsertPlaybookTriggerMail: async (playbookId: string, data: UpsertPlaybookMailTriggerData) => {
        set({ triggerSaving: true, triggerError: null });
        try {
          const pb = await api.upsertPlaybookTriggerMail(playbookId, data);
          const scheduleEnabled = pb.executionSchedule?.enabled === true;
          set((state) => ({
            triggerSaving: false,
            currentPlaybook:
              state.currentPlaybook?.id === playbookId
                ? {
                    ...state.currentPlaybook,
                    executionSchedule: pb.executionSchedule,
                    triggers: pb.triggers,
                    automatedTriggerType: pb.automatedTriggerType,
                  }
                : state.currentPlaybook,
            playbooks: state.playbooks.some((p) => p.id === playbookId)
              ? state.playbooks.map((p) =>
                p.id === playbookId
                  ? { ...p, scheduleEnabled, automatedTriggerType: pb.automatedTriggerType }
                  : p,
              )
              : state.playbooks,
          }));
          toast.success(tPlaybook('store.toasts.triggerMailSaved', 'Mail trigger saved'));
        } catch (err) {
          set({ triggerSaving: false, triggerError: parseApiError(err).message });
          handleApiError(err);
          throw err;
        }
      },

      clearPlaybookTriggerMail: async (playbookId: string) => {
        set({ triggerSaving: true, triggerError: null });
        try {
          const pb = await api.clearPlaybookTriggerMail(playbookId);
          const scheduleEnabled = pb.executionSchedule?.enabled === true;
          set((state) => ({
            triggerSaving: false,
            currentPlaybook:
              state.currentPlaybook?.id === playbookId
                ? {
                    ...state.currentPlaybook,
                    executionSchedule: pb.executionSchedule,
                    triggers: pb.triggers,
                    automatedTriggerType: pb.automatedTriggerType,
                  }
                : state.currentPlaybook,
            playbooks: state.playbooks.some((p) => p.id === playbookId)
              ? state.playbooks.map((p) =>
                p.id === playbookId
                  ? { ...p, scheduleEnabled, automatedTriggerType: pb.automatedTriggerType }
                  : p,
              )
              : state.playbooks,
          }));
          toast.success(tPlaybook('store.toasts.triggerMailCleared', 'Mail trigger removed'));
        } catch (err) {
          set({ triggerSaving: false, triggerError: parseApiError(err).message });
          handleApiError(err);
          throw err;
        }
      },

      syncPlaybookTriggerMailSubscription: async (
        playbookId: string,
        data: SyncPlaybookMailSubscriptionData,
      ) => {
        set({ triggerSaving: true, triggerError: null });
        try {
          await api.syncPlaybookTriggerMailSubscription(playbookId, data);
          const refreshed = await fetchLegacyPlaybookDetail(playbookId);
          const scheduleEnabled = refreshed.executionSchedule?.enabled === true;
          set((state) => ({
            triggerSaving: false,
            currentPlaybook:
              state.currentPlaybook?.id === playbookId
                ? {
                    ...state.currentPlaybook,
                    executionSchedule: refreshed.executionSchedule,
                    triggers: refreshed.triggers,
                    automatedTriggerType: refreshed.automatedTriggerType,
                  }
                : state.currentPlaybook,
            playbooks: state.playbooks.some((p) => p.id === playbookId)
              ? state.playbooks.map((p) =>
                p.id === playbookId
                  ? { ...p, scheduleEnabled, automatedTriggerType: refreshed.automatedTriggerType }
                  : p,
              )
              : state.playbooks,
          }));
          toast.success(tPlaybook('store.toasts.triggerMailSubscriptionSynced', 'Mail subscription synced'));
        } catch (err) {
          set({ triggerSaving: false, triggerError: parseApiError(err).message });
          handleApiError(err);
          throw err;
        }
      },

      toggleFavorite: async (id) => {
        // Optimistic update
        set((state) => ({
          playbooks: state.playbooks.map((p) =>
            p.id === id ? { ...p, isFavorite: !p.isFavorite } : p,
          ),
        }));
        try {
          await api.toggleFavorite(id);
          // Refetch to get server-sorted order (favorites first)
          get().fetchPlaybooks(get().playbooksQuery);
        } catch {
          // Revert on failure
          set((state) => ({
            playbooks: state.playbooks.map((p) =>
              p.id === id ? { ...p, isFavorite: !p.isFavorite } : p,
            ),
          }));
        }
      },

      bulkDeletePlaybooks: async (ids) => {
        const previous = get().playbooks;
        set((state) => ({ playbooks: state.playbooks.filter((p) => !ids.includes(p.id)) }));
        try {
          await api.bulkDeletePlaybooks(ids);
          toast.success(tPlaybook('store.toasts.bulkDeleted', '{{count}} playbooks deleted', { count: ids.length }));
        } catch {
          set({ playbooks: previous });
          toast.error(tPlaybook('store.errors.deleteFailed', 'Failed to delete playbooks'));
        }
      },

      // ===== Canvas =====

      updateTasks: (tasks: PlaybookTask[]) => {
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, tasks }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      updateEdges: (edges: PlaybookEdge[]) => {
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, edges }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      updateControlEdges: (controlEdges: ControlEdge[]) => {
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, controlEdges }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      updateDataBindings: (dataBindings: DataBinding[]) => {
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, dataBindings }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      updateWorkspaces: (workspaces: string[]) => {
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, workspaces }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      setDirty: (dirty: boolean) => set({ isDirty: dirty }),
      setPendingAutosaveAfterCurrent: (pending) => set({ pendingAutosaveAfterCurrent: pending }),

      saveCurrentPlaybook: async (options) => {
        const { currentPlaybook, isSaving } = get();
        if (isSaving) {
          if (options?.reason === 'autosave') {
            set({ pendingAutosaveAfterCurrent: true });
          }
          return;
        }
        if (!currentPlaybook) return;
        const savePayload = buildSavePayload(currentPlaybook, options);
        const payloadTelemetry = api.getPlaybookUpdateTelemetry(savePayload);
        const lastSavedPayloadHash = get().lastSavedPayloadHashByPlaybookId[currentPlaybook.id];
        const shouldSkipSave = lastSavedPayloadHash === payloadTelemetry.payloadHash;

        logPlaybookPerfMetric('playbook_autosave_skipped_hash_match', {
          playbookId: currentPlaybook.id,
          skipped: shouldSkipSave,
          reason: options?.reason ?? 'manual',
        });

        if (shouldSkipSave) {
          set({
            isDirty: false,
            savingDirtyVersion: null,
            pendingAutosaveAfterCurrent: false,
            lastSaveReason: options?.reason ?? 'manual',
          });
          return;
        }

        set({ lastSaveReason: options?.reason ?? 'manual' });
        await get().updatePlaybook(currentPlaybook.id, savePayload);
      },

      // ===== Execution =====

      executePlaybook: async (id, data) => {
        set((state) => ({
          executingPlaybookIds: state.executingPlaybookIds.includes(id)
            ? state.executingPlaybookIds
            : [...state.executingPlaybookIds, id],
          error: null,
        }));
        try {
          const currentPlaybook = get().currentPlaybook?.id === id ? get().currentPlaybook : null;
          const optimisticSelectedTaskId = data?.singleStepTaskId
            || [...(currentPlaybook?.tasks || [])].sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0))[0]?.id
            || null;
          const result = await api.executePlaybook(id, data);
          set((state) => {
            if (state.currentPlaybook?.id !== id) {
              return state;
            }

            const playbook = state.currentPlaybook;
            const sortedTasks = [...playbook.tasks].sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0));
            const runningTaskId = data?.singleStepTaskId || sortedTasks[0]?.id || null;
            let taskResults: PlaybookExecution['taskResults'];
            if (data?.singleStepTaskId && state.currentExecution?.playbookId === id && state.currentExecution.taskResults.length > 0) {
              taskResults = state.currentExecution.taskResults.map((tr) =>
                tr.taskId === data.singleStepTaskId
                  ? { ...clearTaskResultStaleState(tr), status: 'running' as const, output: null, error: null, durationMs: null, startedAt: new Date().toISOString(), completedAt: null }
                  : tr,
              );
            } else {
              taskResults = buildExecutionTaskResultsFromTasks(playbook.tasks, {
                runningTaskId,
                markAllPending: !data?.singleStepTaskId,
              });
            }
            const now = new Date().toISOString();
            const optimisticExecution: PlaybookExecution = {
              id: result.executionId,
              playbookId: id,
              executedBy: state.currentExecution?.executedBy || '',
              executionNumber: (state.executionHistory[0]?.executionNumber || 0) + 1,
              status: 'running',
              executionMode: data?.executionMode || 'live',
              stepExecutionModes: data?.stepExecutionModes ?? {},
              executionTrigger: 'manual',
              reflectionEnabled: data?.runNodeReflection !== false,
              advisorScoringMode: data?.advisorScoringMode ?? state.currentPlaybook?.advisorScoringMode ?? 'llm',
              advisorAutopilotEnabled: data?.advisorAutopilotEnabled === true,
              advisorAutopilotTargetScore: data?.advisorAutopilotTargetScore ?? 90,
              advisorAutopilotMaxTurns: data?.advisorAutopilotMaxTurns ?? 4,
              advisorAutopilotStatus: data?.advisorAutopilotEnabled ? 'running' : 'idle',
              advisorAutopilotTaskId: data?.singleStepTaskId || null,
              advisorAutopilotAttemptCount: 0,
              advisorAutopilotLastError: null,
              judgeSummaryStatus: 'idle',
              judgeSummary: null,
              replaySourceByTask: null,
              replayPlanningByTask: null,
              taskResults,
              threadId: null,
              interruptPayload: null,
              pendingInterrupts: [],
              waitingForHumanInput: false,
              currentInterruptId: null,
              currentInterruptTaskId: null,
              hitlHistory: [],
              error: null,
              durationMs: null,
              startedAt: now,
              completedAt: null,
              singleStepTaskId: data?.singleStepTaskId || null,
              playbookSnapshot: null,
              totalInputTokens: 0,
              totalOutputTokens: 0,
              totalTokens: 0,
              createdAt: now,
              updatedAt: now,
            };

            return {
              currentExecution: optimisticExecution,
              executionCache: evictCache({ ...state.executionCache, [result.executionId]: optimisticExecution }),
              selectedStepId: data?.singleStepTaskId || sortedTasks[0]?.id || null,
              executionPanelOpen: true,
              nodeEditorOpen: false,
              pageMode: 'run',
            };
          });
          syncUiStoreForRun(optimisticSelectedTaskId);
          return result.executionId;
        } catch (err) {
          set((state) => ({
            executingPlaybookIds: state.executingPlaybookIds.filter((pid) => pid !== id),
          }));
          handleApiError(err);
          throw err;
        }
      },

      stopExecution: async (playbookId, executionId) => {
        set({ isStopping: true });
        try {
          if (playbookFeatures.queryMutationsEnabled) {
            await cancelExecutionMutation(executionId);
          } else {
            await api.cancelFlowExecution(executionId);
          }
          set({ isStopping: false });
        } catch (err) {
          set({ isStopping: false });
          const apiError = parseApiError(err);
          if (apiError.code === 'ERR_1006') {
            set((state) => {
              const executionCache = { ...state.executionCache };
              const cached = executionCache[executionId];
              if (cached) {
                executionCache[executionId] = {
                  ...cached,
                  status: 'completed',
                  waitingForHumanInput: false,
                  interruptPayload: null,
                  pendingInterrupts: [],
                  taskResults: cached.taskResults.map((tr) =>
                    tr.status === 'running' || tr.status === 'interrupted'
                      ? { ...tr, status: 'completed' as const }
                      : tr,
                  ),
                };
              }
              const executingPlaybookIds = state.executingPlaybookIds.filter((pid) => pid !== playbookId);
              const currentExecution =
                state.currentExecution?.id === executionId
                  ? executionCache[executionId] ?? state.currentExecution
                  : state.currentExecution;
              return {
                executionCache,
                currentExecution,
                executingPlaybookIds,
                copilotMode: 'design' as const,
                waitingForHumanInput: false,
              };
            });
            return;
          }
          handleApiError(err);
          throw err;
        }
      },

      skipExecutionStep: async (playbookId, executionId, taskId) => {
        try {
          await api.skipPlaybookStep(playbookId, { executionId, taskId });
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      deleteExecution: async (playbookId, executionId) => {
        try {
          await api.deleteExecution(playbookId, executionId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
        const currentId = get().currentExecution?.id;
        if (currentId === executionId) {
          persistPanelOpen(false);
        }
        set((state) => {
          const { [executionId]: _removed, ...restCache } = state.executionCache;
          return {
            executionCache: restCache,
            executionHistory: state.executionHistory.filter((h) => h.id !== executionId),
            executionHistoryByPlaybook: {
              ...state.executionHistoryByPlaybook,
              [playbookId]: (state.executionHistoryByPlaybook[playbookId] || []).filter((h) => h.id !== executionId),
            },
            currentExecution: currentId === executionId ? null : state.currentExecution,
            executionPanelOpen: currentId === executionId ? false : state.executionPanelOpen,
          };
        });
      },

      deleteStepExecution: async (playbookId, executionId, taskId, stepExecutionId) => {
        try {
          await api.deleteStepExecution(playbookId, executionId, taskId, stepExecutionId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      deleteAllExecutions: async (playbookId) => {
        try {
          await api.deleteAllExecutions(playbookId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
        const currentExec = get().currentExecution;
        if (currentExec && currentExec.playbookId === playbookId) {
          persistPanelOpen(false);
        }
        set((state) => {
          const newCache = { ...state.executionCache };
          for (const [id, exec] of Object.entries(newCache)) {
            if ((exec as PlaybookExecution).playbookId === playbookId) {
              delete newCache[id];
            }
          }
          return {
            executionCache: newCache,
            executionHistory: state.executionHistory.filter((h) => h.playbookId !== playbookId),
            executionHistoryByPlaybook: {
              ...state.executionHistoryByPlaybook,
              [playbookId]: [],
            },
            currentExecution: currentExec?.playbookId === playbookId ? null : state.currentExecution,
            executionPanelOpen: currentExec?.playbookId === playbookId ? false : state.executionPanelOpen,
          };
        });
      },

      validateTaskReplay: async (playbookId, taskId, executionId, options) => {
        set((state) => ({
          currentPlaybook: state.currentPlaybook?.id === playbookId
            ? {
              ...state.currentPlaybook,
              tasks: state.currentPlaybook.tasks.map((task) =>
                task.id === taskId
                  ? {
                    ...task,
                    isSavingReplayBaseline: true,
                  }
                  : task,
              ),
            }
            : state.currentPlaybook,
        }));
        try {
          const replayPayload = {
            executionId,
            preserveOutputFormat: options?.preserveOutputFormat || false,
            ...(options?.replayConfig ? { replayConfig: options.replayConfig } : {}),
          };
          const replay = playbookFeatures.queryMutationsEnabled
            ? await validateReplayMutation({ playbookId, taskId, data: replayPayload })
            : await api.validateTaskReplay(playbookId, taskId, replayPayload);
          invalidateTaskReplayReads(playbookId, taskId);
          set((state) => ({
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === taskId
                    ? {
                      ...task,
                      hasValidatedReplay: true,
                      activeReplayId: replay.id,
                      activeReplayVersion: replay.validationVersion,
                      activeReplayIsStale: replay.isStale || false,
                      activeReplayStaleReasons: replay.staleReasons || [],
                      activeReplayPreserveOutputFormat: replay.preserveOutputFormat || false,
                      activeReplayFormatGuideStatus: replay.formatGuideStatus || 'disabled',
                      activeReplayFormatGuideError: replay.formatGuideError || null,
                      hasOutputFormatTemplate: task.hasOutputFormatTemplate,
                      activeOutputFormatTemplateId: task.activeOutputFormatTemplateId,
                      activeOutputFormatTemplateVersion: task.activeOutputFormatTemplateVersion,
                      activeOutputFormatStatus: task.activeOutputFormatStatus || null,
                      activeOutputFormatError: task.activeOutputFormatError || null,
                      isSavingReplayBaseline: false,
                    }
                    : task,
                ),
              }
              : state.currentPlaybook,
          }));
          toast.success(tPlaybook('store.toasts.saved', 'Replay baseline saved'));
          return replay;
        } catch (err) {
          set((state) => ({
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === taskId
                    ? {
                      ...task,
                      isSavingReplayBaseline: false,
                    }
                    : task,
                ),
              }
              : state.currentPlaybook,
          }));
          handleApiError(err);
          throw err;
        }
      },

      traceReplayExecution: async (executionId: string) => {
        try {
          return await api.traceReplayExecution(executionId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      reExecuteExecution: async (executionId: string) => {
        try {
          return await api.reExecuteExecution(executionId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      fetchTaskReplays: async (playbookId, taskId) => {
        try {
          return await fetchTaskReplayList(playbookId, taskId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      activateTaskReplay: async (playbookId, taskId, replayId) => {
        try {
          const replay = await api.activateTaskReplay(playbookId, taskId, replayId);
          invalidateTaskReplayReads(playbookId, taskId);
          set((state) => ({
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === taskId
                    ? {
                      ...task,
                      hasValidatedReplay: true,
                      activeReplayId: replay.id,
                      activeReplayVersion: replay.validationVersion,
                      activeReplayIsStale: replay.isStale || false,
                      activeReplayStaleReasons: replay.staleReasons || [],
                      activeReplayPreserveOutputFormat: replay.preserveOutputFormat || false,
                      activeReplayFormatGuideStatus: replay.formatGuideStatus || 'disabled',
                      activeReplayFormatGuideError: replay.formatGuideError || null,
                      activeReplayLabel: replay.label || null,
                      hasOutputFormatTemplate: task.hasOutputFormatTemplate,
                      activeOutputFormatTemplateId: task.activeOutputFormatTemplateId,
                      activeOutputFormatTemplateVersion: task.activeOutputFormatTemplateVersion,
                      activeOutputFormatStatus: task.activeOutputFormatStatus || null,
                      activeOutputFormatError: task.activeOutputFormatError || null,
                      isSavingReplayBaseline: false,
                    }
                    : task,
                ),
              }
              : state.currentPlaybook,
          }));
          toast.success(tPlaybook('store.toasts.saved', 'Replay baseline activated'));
          return replay;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      deleteTaskReplay: async (playbookId, taskId, replayId) => {
        try {
          const result = await api.deleteTaskReplay(playbookId, taskId, replayId);
          invalidateTaskReplayReads(playbookId, taskId);
          set((state) => ({
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === taskId
                    ? {
                      ...task,
                      hasValidatedReplay: result.wasActive ? false : task.hasValidatedReplay,
                      activeReplayId: result.wasActive ? null : task.activeReplayId,
                      activeReplayVersion: result.wasActive ? null : task.activeReplayVersion,
                      activeReplayIsStale: result.wasActive ? false : task.activeReplayIsStale,
                      activeReplayStaleReasons: result.wasActive ? [] : task.activeReplayStaleReasons,
                      activeReplayPreserveOutputFormat: result.wasActive ? false : task.activeReplayPreserveOutputFormat,
                      activeReplayFormatGuideStatus: result.wasActive ? 'disabled' : task.activeReplayFormatGuideStatus,
                      activeReplayFormatGuideError: result.wasActive ? null : task.activeReplayFormatGuideError,
                      activeReplayLabel: result.wasActive ? null : task.activeReplayLabel,
                      hasOutputFormatTemplate: task.hasOutputFormatTemplate,
                      activeOutputFormatTemplateId: task.activeOutputFormatTemplateId,
                      activeOutputFormatTemplateVersion: task.activeOutputFormatTemplateVersion,
                      activeOutputFormatStatus: task.activeOutputFormatStatus,
                      activeOutputFormatError: task.activeOutputFormatError,
                      isSavingReplayBaseline: false,
                    }
                    : task,
                ),
              }
              : state.currentPlaybook,
          }));
          toast.success(tPlaybook('store.toasts.replayDeleted', 'Replay baseline removed'));
          return result;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      renameTaskReplay: async (playbookId, taskId, replayId, label) => {
        try {
          const replay = await api.updateTaskReplayLabel(playbookId, taskId, replayId, label);
          invalidateTaskReplayReads(playbookId, taskId);
          set((state) => ({
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === taskId && task.activeReplayId === replayId
                    ? { ...task, activeReplayLabel: replay.label || null }
                    : task,
                ),
              }
              : state.currentPlaybook,
          }));
          toast.success(tPlaybook('store.toasts.replayRenamed', 'Replay baseline renamed'));
          return replay;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      fetchEvaluationExecutions: async (playbookId, taskId) => {
        try {
          const executions = await fetchEvaluationExecutionList(playbookId, taskId);
          if (taskId) {
            set((state) => ({
              evaluationExecutionsByTask: {
                ...state.evaluationExecutionsByTask,
                [taskId]: executions,
              },
            }));
          }
          return executions;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      fetchEvaluationBaseline: async (playbookId, taskId) => {
        try {
          const baseline = await fetchEvaluationBaselineDetail(playbookId, taskId);
          set((state) => ({
            evaluationBaselinesByTask: {
              ...state.evaluationBaselinesByTask,
              [taskId]: baseline,
            },
          }));
          return baseline;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      createEvaluationBaselineFromExecution: async (playbookId, taskId, executionId) => {
        try {
          const baseline = await api.createEvaluationBaselineFromExecution(playbookId, taskId, executionId);
          set((state) => ({
            evaluationBaselinesByTask: {
              ...state.evaluationBaselinesByTask,
              [taskId]: baseline,
            },
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                  ...state.currentPlaybook,
                  tasks: state.currentPlaybook.tasks.map((task) => task.id === taskId
                    ? {
                        ...task,
                        evaluationConfig: task.evaluationConfig
                          ? { ...task.evaluationConfig, referenceBaselineId: baseline.id }
                          : task.evaluationConfig,
                      }
                    : task),
                }
              : state.currentPlaybook,
          }));
          return baseline;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      createEvaluationBaselineFromCurrentExecution: async (playbookId, taskId, executionId, evaluationExecutionId) => {
        try {
          const baseline = await api.createEvaluationBaselineFromCurrentExecution(playbookId, taskId, executionId, evaluationExecutionId);
          set((state) => ({
            evaluationBaselinesByTask: {
              ...state.evaluationBaselinesByTask,
              [taskId]: baseline,
            },
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                  ...state.currentPlaybook,
                  tasks: state.currentPlaybook.tasks.map((task) => task.id === taskId
                    ? {
                        ...task,
                        evaluationConfig: task.evaluationConfig
                          ? { ...task.evaluationConfig, referenceBaselineId: baseline.id }
                          : task.evaluationConfig,
                      }
                    : task),
                }
              : state.currentPlaybook,
          }));
          return baseline;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      deleteEvaluationBaseline: async (playbookId, taskId) => {
        try {
          const result = await api.deleteEvaluationBaseline(playbookId, taskId);
          set((state) => ({
            evaluationBaselinesByTask: {
              ...state.evaluationBaselinesByTask,
              [taskId]: null,
            },
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                  ...state.currentPlaybook,
                  tasks: state.currentPlaybook.tasks.map((task) => task.id === taskId
                    ? {
                        ...task,
                        evaluationConfig: task.evaluationConfig
                          ? { ...task.evaluationConfig, referenceBaselineId: null }
                          : task.evaluationConfig,
                      }
                    : task),
                }
              : state.currentPlaybook,
          }));
          return result;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      fetchRepeatability: async (playbookId, limit = 5, offset = 0) => {
        set({ repeatabilityLoading: true });
        try {
          const result = await fetchPlaybookRepeatability(playbookId, limit, offset);
          set({ repeatability: result, repeatabilityLoading: false });
          return result;
        } catch (err) {
          set({ repeatabilityLoading: false });
          handleApiError(err);
          throw err;
        }
      },

      clearRepeatability: () => {
        set({ repeatability: null, repeatabilityLoading: false });
      },

      updateTaskReplayFormatGuide: async (playbookId, taskId, replayId, data) => {
        try {
          const replay = await api.updateTaskReplayFormatGuide(playbookId, taskId, replayId, data);
          invalidateTaskReplayReads(playbookId, taskId);
          set((state) => ({
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === taskId
                    ? {
                      ...task,
                      hasValidatedReplay: true,
                      activeReplayId: replay.status === 'active' ? replay.id : task.activeReplayId,
                      activeReplayVersion: replay.status === 'active' ? replay.validationVersion : task.activeReplayVersion,
                      activeReplayIsStale: replay.isStale || false,
                      activeReplayStaleReasons: replay.staleReasons || [],
                      activeReplayPreserveOutputFormat: replay.preserveOutputFormat || false,
                      activeReplayFormatGuideStatus: replay.formatGuideStatus || 'disabled',
                      activeReplayFormatGuideError: replay.formatGuideError || null,
                      activeReplayReplayConfig: replay.replayConfig || { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
                      hasOutputFormatTemplate: task.hasOutputFormatTemplate,
                      activeOutputFormatTemplateId: task.activeOutputFormatTemplateId,
                      activeOutputFormatTemplateVersion: task.activeOutputFormatTemplateVersion,
                      activeOutputFormatStatus: task.activeOutputFormatStatus || null,
                      activeOutputFormatError: task.activeOutputFormatError || null,
                      isSavingReplayBaseline: false,
                    }
                    : task,
                ),
              }
              : state.currentPlaybook,
          }));
          toast.success(tPlaybook('store.toasts.saved', 'Replay format guide updated'));
          return replay;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      grabOutputFormatTemplate: async (playbookId, taskId, data) => {
        set((state) => ({
          currentPlaybook: state.currentPlaybook?.id === playbookId
            ? {
              ...state.currentPlaybook,
              tasks: state.currentPlaybook.tasks.map((task) =>
                task.id === taskId
                  ? {
                    ...task,
                    isCapturingOutputFormat: true,
                    activeOutputFormatStatus: 'pending',
                    activeOutputFormatError: null,
                  }
                  : task,
              ),
            }
            : state.currentPlaybook,
        }));
        try {
          const template = await api.grabOutputFormatTemplate(playbookId, taskId, data);
          invalidateOutputFormatTemplateRead(playbookId, taskId);
          set((state) => ({
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === taskId
                    ? {
                      ...task,
                      hasOutputFormatTemplate: true,
                      activeOutputFormatTemplateId: template.id,
                      activeOutputFormatTemplateVersion: template.templateVersion,
                      activeOutputFormatStatus: template.generationStatus,
                      activeOutputFormatError: template.generationError || null,
                      isCapturingOutputFormat: template.generationStatus === 'pending',
                    }
                    : task,
                ),
              }
              : state.currentPlaybook,
          }));
          toast.success('Output format captured');
          return template;
        } catch (err) {
          set((state) => ({
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === taskId
                    ? {
                      ...task,
                      isCapturingOutputFormat: false,
                      activeOutputFormatStatus: task.activeOutputFormatTemplateId ? task.activeOutputFormatStatus : null,
                    }
                    : task,
                ),
              }
              : state.currentPlaybook,
          }));
          handleApiError(err);
          throw err;
        }
      },

      fetchOutputFormatTemplate: async (playbookId, taskId) => {
        try {
          return await fetchOutputFormatTemplateDetail(playbookId, taskId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      refreshOutputFormatStatus: async (playbookId, taskId) => {
        try {
          const template = await fetchOutputFormatTemplateDetail(playbookId, taskId);
          if (!template) return;
          set((state) => ({
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === taskId
                    ? {
                      ...task,
                      hasOutputFormatTemplate: template.status === 'active',
                      activeOutputFormatTemplateId: template.status === 'active' ? template.id : task.activeOutputFormatTemplateId,
                      activeOutputFormatTemplateVersion: template.status === 'active' ? template.templateVersion : task.activeOutputFormatTemplateVersion,
                      activeOutputFormatStatus: template.generationStatus,
                      activeOutputFormatError: template.generationError || null,
                      isCapturingOutputFormat: template.generationStatus === 'pending',
                    }
                    : task,
                ),
              }
              : state.currentPlaybook,
          }));
        } catch {
          // silent — polling will retry
        }
      },

      updateOutputFormatTemplate: async (playbookId, taskId, data) => {
        try {
          const template = playbookFeatures.queryMutationsEnabled
            ? await updateOutputFormatTemplateMutation({ playbookId, taskId, data })
            : await api.updateOutputFormatTemplate(playbookId, taskId, data);
          invalidateOutputFormatTemplateRead(playbookId, taskId);
          set((state) => ({
            currentPlaybook: state.currentPlaybook?.id === playbookId
              ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === taskId
                    ? {
                      ...task,
                      hasOutputFormatTemplate: true,
                      activeOutputFormatTemplateId: template.id,
                      activeOutputFormatTemplateVersion: template.templateVersion,
                      activeOutputFormatStatus: template.generationStatus,
                      activeOutputFormatError: template.generationError || null,
                      isCapturingOutputFormat: template.generationStatus === 'pending',
                    }
                    : task,
                ),
              }
              : state.currentPlaybook,
          }));
          toast.success('Output format template updated');
          return template;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      deleteOutputFormatTemplate: async (playbookId, taskId) => {
        try {
          const result = await api.deleteOutputFormatTemplate(playbookId, taskId);
          invalidateOutputFormatTemplateRead(playbookId, taskId);
          if (result.removed) {
            set((state) => ({
              currentPlaybook: state.currentPlaybook?.id === playbookId
                ? {
                  ...state.currentPlaybook,
                  tasks: state.currentPlaybook.tasks.map((task) =>
                    task.id === taskId
                      ? {
                        ...task,
                        hasOutputFormatTemplate: false,
                        activeOutputFormatTemplateId: null,
                        activeOutputFormatTemplateVersion: null,
                        activeOutputFormatStatus: null,
                        activeOutputFormatError: null,
                        isCapturingOutputFormat: false,
                      }
                      : task,
                  ),
                }
                : state.currentPlaybook,
            }));
            toast.success('Output format template removed');
          }
          return result;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      runAdvisorEvaluation: async (executionId, taskId, iteration) => {
        const matchesTargetIteration = (taskResult: PlaybookExecution['taskResults'][number]) => (
          taskResult.taskId === taskId
          && (iteration === undefined || iterationsMatch(taskResult.iteration, iteration))
        );

        set((state) => {
          const cached = state.executionCache[executionId];
          if (!cached) return state;

          const taskResults = cached.taskResults.map((taskResult) => (
            matchesTargetIteration(taskResult)
              ? { ...taskResult, judgeStatus: 'evaluating' as const, judgeError: null, judgeResult: null }
              : taskResult
          ));
          const updatedExecution = { ...cached, taskResults, updatedAt: new Date().toISOString() };

          return {
            executionCache: { ...state.executionCache, [executionId]: updatedExecution },
            currentExecution: state.currentExecution?.id === executionId ? updatedExecution : state.currentExecution,
          };
        });

        try {
          const result = await api.runAdvisorEvaluation(
            executionId,
            taskId,
            iteration,
            get().executionCache[executionId]?.advisorScoringMode,
          );
          set((state) => {
            const cached = state.executionCache[result.executionId];
            if (!cached) return state;

            const taskResults = cached.taskResults.map((taskResult) => (
              taskResult.taskId === result.taskId
                && iterationsMatch(taskResult.iteration, result.taskResult.iteration)
                ? {
                    ...taskResult,
                    judgeStatus: result.taskResult.judgeStatus,
                    judgeResult: result.taskResult.judgeResult,
                    judgeError: result.taskResult.judgeError,
                    judgeScoringMode: result.taskResult.judgeScoringMode,
                    judgeHistory: result.taskResult.judgeHistory,
                  }
                : taskResult
            ));
            const updatedExecution: PlaybookExecution = {
              ...cached,
              taskResults,
              ...(result.judgeSummaryStatus !== undefined ? { judgeSummaryStatus: result.judgeSummaryStatus } : {}),
              ...(result.judgeSummary !== undefined ? { judgeSummary: result.judgeSummary } : {}),
              updatedAt: new Date().toISOString(),
            };

            return {
              executionCache: { ...state.executionCache, [result.executionId]: updatedExecution },
              currentExecution: state.currentExecution?.id === result.executionId ? updatedExecution : state.currentExecution,
            };
          });
        } catch (err) {
          const message = parseApiError(err).message;
          set((state) => {
            const cached = state.executionCache[executionId];
            if (!cached) return state;

            const taskResults = cached.taskResults.map((taskResult) => (
              matchesTargetIteration(taskResult)
                ? { ...taskResult, judgeStatus: 'failed' as const, judgeError: message }
                : taskResult
            ));
            const updatedExecution = { ...cached, taskResults, updatedAt: new Date().toISOString() };

            return {
              executionCache: { ...state.executionCache, [executionId]: updatedExecution },
              currentExecution: state.currentExecution?.id === executionId ? updatedExecution : state.currentExecution,
            };
          });
          handleApiError(err);
          throw err;
        }
      },

      fetchAdvisorRemediations: async (playbookId, executionId, taskId) => {
        return fetchAdvisorRemediationList(playbookId, executionId, taskId);
      },

      reapplyOptimization: async (playbookId, executionId, taskId, historyIndex, direction) => {
        try {
          const updated = await api.reapplyOptimization(playbookId, executionId, taskId, historyIndex, direction);
          const summary: PlaybookSummary = {
            id: updated.id,
            name: updated.name,
            description: updated.description,
            taskCount: (updated.tasks ?? updated.nodes ?? []).length,
            isFavorite: updated.isFavorite,
            scheduleEnabled: updated.executionSchedule?.enabled === true,
            executionStatus: null,
            lastExecutionAt: null,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          };
          set((state) => ({
            playbooks: [summary, ...state.playbooks.filter((playbook) => playbook.id !== updated.id)],
            currentPlaybook: updated,
            pendingRerunTaskId: direction === 'after' ? taskId : null,
          }));
          toast.success(tPlaybook('store.toasts.optimizationReapplied', 'Optimization reapplied'));
          return updated;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      setPendingRerunTaskId: (taskId) => set({ pendingRerunTaskId: taskId }),

      resumeExecution: async (id, data) => {
        const action = data.action || (data.approved === true ? 'approve' : data.feedback || data.message ? 'reply' : 'reject');
        const message = data.message || data.feedback || data.reason || '';
        const interruptId = data.interruptId || undefined;
        const currentExecution = get().currentExecution;
        const interruptedTask = currentExecution?.taskResults.find(
          (taskResult) => taskResult.taskId === data.taskId && taskResult.status === 'interrupted',
        ) || null;
        // Optimistically mark the humanFeedback component as answered
        set((state) => {
          if (!state.currentExecution) return state;
          const taskResults = state.currentExecution.taskResults.map((tr) => {
            if (tr.taskId !== data.taskId) return tr;
            const components = (tr.components || []).map((comp) => {
              if (
                comp.type === 'humanFeedback'
                && (comp.data as any)?.status === 'pending'
                && (!interruptId || ((comp.data as any)?.interruptId || '') === interruptId)
              ) {
                return {
                  ...comp,
                  data: {
                    ...comp.data,
                    status: 'answered',
                    action,
                    replyMessage: message,
                    approved: data.approved,
                    reason: data.reason || '',
                    feedback: data.feedback || '',
                    scope: data.scope,
                    remember: data.remember,
                    humanResponse: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action,
                  },
                };
              }
              return comp;
            });
            return { ...tr, components };
          });
          const hitlHistory = (state.currentExecution.hitlHistory || []).map((entry) => (
            entry.status === 'pending'
              && entry.taskId === data.taskId
              && (!interruptId || entry.interruptId === interruptId)
              ? {
                  ...entry,
                  status: 'answered' as const,
                  responseAction: action,
                  responseMessage: message || null,
                responseApproved: data.approved ?? null,
                responseReason: data.reason || null,
                responseFeedback: data.feedback || null,
                responseScope: data.scope ?? null,
                responseRemember: data.remember ?? null,
              }
              : entry
          ));
          const pendingInterrupts = removePendingInterrupt(
            state.currentExecution.pendingInterrupts,
            data.taskId,
            interruptId,
          );
          const nextInterrupt = pendingInterrupts[0] ?? null;
          const updatedExec: PlaybookExecution = {
            ...state.currentExecution,
            taskResults,
            status: nextInterrupt ? 'interrupted' : 'running',
            interruptPayload: nextInterrupt,
            pendingInterrupts,
            waitingForHumanInput: pendingInterrupts.length > 0,
            currentInterruptId: nextInterrupt?.interruptId || null,
            currentInterruptTaskId: nextInterrupt?.taskId || null,
            hitlHistory,
            updatedAt: new Date().toISOString(),
          };
          return {
            currentExecution: updatedExec,
            executionCache: { ...state.executionCache, [state.currentExecution.id]: updatedExec },
            executingPlaybookIds: state.executingPlaybookIds.includes(state.currentExecution.playbookId)
              ? state.executingPlaybookIds
              : [...state.executingPlaybookIds, state.currentExecution.playbookId],
          };
        });
        try {
          if (interruptedTask) {
            const resumeData = {
              taskId: data.taskId,
              action,
              interruptId,
              iteration: interruptedTask.iteration,
              message: data.message,
              approved: data.approved,
              reason: data.reason,
              feedback: data.feedback,
              scope: data.scope,
              remember: data.remember,
            };
            if (playbookFeatures.queryMutationsEnabled) {
              await resumeFromStepMutation({ playbookId: id, executionId: data.executionId, data: resumeData });
            } else {
              await api.resumePlaybookFromStep(id, data.executionId, resumeData);
            }
          } else {
            const resumePayload = {
              taskId: data.taskId,
              interruptId,
              message: data.message,
              approved: data.approved,
              reason: data.reason,
              feedback: data.feedback,
              scope: data.scope,
              remember: data.remember,
            };
            if (playbookFeatures.queryMutationsEnabled) {
              await resumeApprovalMutation({ executionId: data.executionId, decision: action, payload: resumePayload });
            } else {
              await api.resumeFlowApproval(data.executionId, action, resumePayload);
            }
          }
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      rerunStepInExecution: async (playbookId, executionId, taskId, runEvaluation = false, executionMode = 'live', streaming = false, runNodeReflection = true, advisorAutopilotEnabled = false, advisorAutopilotTargetScore, advisorAutopilotMaxTurns, skipStepExecution = false) => {
        try {
          await api.rerunPlaybookStep(playbookId, executionId, {
            taskId,
            runEvaluation,
            executionMode,
            streaming,
            runNodeReflection,
            advisorAutopilotEnabled,
            advisorAutopilotTargetScore,
            advisorAutopilotMaxTurns,
            skipStepExecution,
          });
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      resumeFromStep: async (playbookId, executionId, taskId, options = {}) => {
        try {
          const resumeData = {
            taskId,
            streaming: options.streaming ?? false,
            action: options.action,
            interruptId: options.interruptId,
            iteration: options.iteration,
            message: options.message,
            approved: options.approved,
            reason: options.reason,
            feedback: options.feedback,
            scope: options.scope,
            remember: options.remember,
            payload: options.payload,
          };
          if (playbookFeatures.queryMutationsEnabled) {
            await resumeFromStepMutation({ playbookId, executionId, data: resumeData });
          } else {
            await api.resumePlaybookFromStep(playbookId, executionId, resumeData);
          }
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      disableHitlBlocker: async (executionId, interruptId) => {
        try {
          await api.disableHitlBlocker(executionId, interruptId);
          toast.success(tPlaybook('interrupt.blockerDisabled', 'This blocker is disabled for future runs.'));
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      runFromStep: async (playbookId, sourceExecutionId, taskId, iteration) => {
        try {
          const result = await api.runPlaybookFromStep(playbookId, sourceExecutionId, {
            taskId,
            iteration,
          });
          set((state) => {
            const currentPlaybook = state.currentPlaybook?.id === playbookId ? state.currentPlaybook : null;
            const sourceExecution = state.currentExecution?.id === sourceExecutionId
              ? state.currentExecution
              : state.executionCache[sourceExecutionId] ?? null;

            const optimisticTaskResults = currentPlaybook && sourceExecution
              ? buildReplayTaskResultsFromSource(sourceExecution, currentPlaybook, taskId)
              : currentPlaybook
                ? buildExecutionTaskResultsFromTasks(currentPlaybook.tasks, { runningTaskId: taskId })
                : [];

            const now = new Date().toISOString();
            const newExecution: PlaybookExecution = {
              id: result.executionId,
              playbookId,
              executedBy: sourceExecution?.executedBy || '',
              executionNumber: (state.executionHistoryByPlaybook[playbookId]?.[0]?.executionNumber || state.executionHistory[0]?.executionNumber || 0) + 1,
              status: 'running',
              executionMode: sourceExecution?.executionMode || 'live',
              stepExecutionModes: sourceExecution?.stepExecutionModes ?? {},
              executionTrigger: 'manual',
              reflectionEnabled: sourceExecution?.reflectionEnabled !== false,
              advisorScoringMode: sourceExecution?.advisorScoringMode ?? currentPlaybook?.advisorScoringMode ?? 'llm',
              advisorAutopilotEnabled: sourceExecution?.advisorAutopilotEnabled === true,
              advisorAutopilotTargetScore: sourceExecution?.advisorAutopilotTargetScore ?? 90,
              advisorAutopilotMaxTurns: sourceExecution?.advisorAutopilotMaxTurns ?? 4,
              advisorAutopilotStatus: 'idle',
              advisorAutopilotTaskId: null,
              advisorAutopilotAttemptCount: 0,
              advisorAutopilotLastError: null,
              judgeSummaryStatus: 'idle',
              judgeSummary: null,
              replaySourceByTask: null,
              replayPlanningByTask: null,
              taskResults: optimisticTaskResults,
              threadId: null,
              interruptPayload: null,
              pendingInterrupts: [],
              waitingForHumanInput: false,
              currentInterruptId: null,
              currentInterruptTaskId: null,
              hitlHistory: [],
              error: null,
              durationMs: null,
              startedAt: now,
              completedAt: null,
              singleStepTaskId: taskId,
              playbookSnapshot: null,
              totalInputTokens: 0,
              totalOutputTokens: 0,
              totalTokens: 0,
              createdAt: now,
              updatedAt: now,
            };

            const newSummary: PlaybookExecutionSummary = {
              id: result.executionId,
              playbookId,
              executedBy: sourceExecution?.executedBy || '',
              executionNumber: newExecution.executionNumber,
              status: 'running',
              executionTrigger: 'manual',
              error: null,
              durationMs: null,
              startedAt: now,
              completedAt: null,
              singleStepTaskId: taskId,
              createdAt: now,
              updatedAt: now,
            };

            return {
              executingPlaybookIds: state.executingPlaybookIds.includes(playbookId)
                ? state.executingPlaybookIds
                : [...state.executingPlaybookIds, playbookId],
              currentExecution: state.currentPlaybook?.id === playbookId ? newExecution : state.currentExecution,
              executionCache: evictCache({ ...state.executionCache, [result.executionId]: newExecution }),
              executionHistory: [newSummary, ...state.executionHistory].slice(0, MAX_EXECUTION_HISTORY),
              executionHistoryByPlaybook: {
                ...state.executionHistoryByPlaybook,
                [playbookId]: [newSummary, ...(state.executionHistoryByPlaybook[playbookId] || [])].slice(0, MAX_EXECUTION_HISTORY),
              },
              selectedStepId: state.currentPlaybook?.id === playbookId ? taskId : state.selectedStepId,
              executionPanelOpen: state.currentPlaybook?.id === playbookId ? true : state.executionPanelOpen,
              pageMode: state.currentPlaybook?.id === playbookId ? 'run' : state.pageMode,
            };
          });
          void get().fetchExecution(playbookId, result.executionId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      // ===== SSE Handlers =====

      onExecutionStart: (data: PlaybookExecutionStartEvent) => {
        const incomingTaskResults = data.taskResults ?? [];
        set((state) => {
          let taskResults = incomingTaskResults;
          const previous = state.executionCache[data.executionId]
            ?? (state.currentExecution?.id === data.executionId ? state.currentExecution : null);
          const replayTargetTaskId = data.singleStepTaskId ?? previous?.singleStepTaskId ?? null;
          const shouldPreserveOptimisticReplay = incomingTaskResults.length === 0 && !!previous?.singleStepTaskId;
          if (replayTargetTaskId && (data.singleStepTaskId || shouldPreserveOptimisticReplay)) {
            if (previous && previous.taskResults.length > 0) {
              taskResults = previous.taskResults.map((tr) =>
                tr.taskId === replayTargetTaskId
                  ? { ...clearTaskResultStaleState(tr), status: 'running' as const, output: null, error: null, durationMs: null, startedAt: new Date().toISOString(), completedAt: null }
                  : tr,
              );
            }
          }
          const newExecution: PlaybookExecution = {
            id: data.executionId,
            playbookId: data.playbookId,
            executedBy: '',
            executionNumber: data.executionNumber,
            status: data.status as any,
            executionMode: data.executionMode || 'live',
            stepExecutionModes: data.stepExecutionModes ?? {},
            executionTrigger: 'manual',
            reflectionEnabled: data.reflectionEnabled !== false,
            advisorScoringMode: data.advisorScoringMode ?? 'llm',
            advisorAutopilotEnabled: data.advisorAutopilotEnabled === true,
            advisorAutopilotTargetScore: data.advisorAutopilotTargetScore ?? 90,
            advisorAutopilotMaxTurns: data.advisorAutopilotMaxTurns ?? 4,
            advisorAutopilotStatus: data.advisorAutopilotStatus || 'idle',
            advisorAutopilotTaskId: data.advisorAutopilotTaskId ?? null,
            advisorAutopilotAttemptCount: data.advisorAutopilotAttemptCount ?? 0,
            advisorAutopilotLastError: data.advisorAutopilotLastError ?? null,
            judgeSummaryStatus: 'idle',
            judgeSummary: null,
            replaySourceByTask: data.replaySourceByTask || null,
            replayPlanningByTask: data.replayPlanningByTask || null,
            taskResults,
            threadId: null,
            interruptPayload: null,
            pendingInterrupts: [],
            waitingForHumanInput: false,
            currentInterruptId: null,
            currentInterruptTaskId: null,
            hitlHistory: [],
            error: null,
            durationMs: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
            singleStepTaskId: replayTargetTaskId,
            playbookSnapshot: null,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          const newSummary: PlaybookExecutionSummary = {
            id: data.executionId,
            playbookId: data.playbookId,
            executedBy: '',
            executionNumber: data.executionNumber,
            status: data.status as any,
            executionTrigger: 'manual',
            error: null,
            durationMs: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
            singleStepTaskId: replayTargetTaskId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          const sorted = [...taskResults].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const firstStep = sorted.find((tr) => tr.status === 'running') ?? sorted.find((tr) => tr.status === 'pending') ?? sorted[0];
          const shouldSetCurrent = state.currentPlaybook?.id === data.playbookId;
          const executionCache = evictCache({ ...state.executionCache, [data.executionId]: newExecution });
          if (shouldSetCurrent) {
            syncUiStoreForRun(firstStep?.taskId ?? null);
          }
          return {
            executingPlaybookIds: state.executingPlaybookIds.includes(data.playbookId)
              ? state.executingPlaybookIds
              : [...state.executingPlaybookIds, data.playbookId],
            playbooks: updatePlaybookExecutionStatus(state.playbooks, data.playbookId, data.status as ExecutionStatus),
            currentExecution: shouldSetCurrent ? newExecution : state.currentExecution,
            executionCache,
            executionHistory: [newSummary, ...state.executionHistory].slice(0, MAX_EXECUTION_HISTORY),
            selectedStepId: shouldSetCurrent ? (firstStep?.taskId ?? null) : state.selectedStepId,
            executionPanelOpen: shouldSetCurrent ? true : state.executionPanelOpen,
          };
        });
      },

      onStepStart: (data: PlaybookStepStartEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const existing = normalizeRunningTaskResultsForStart(
            cached.taskResults,
            data.taskId,
            state.currentPlaybook?.id === cached.playbookId ? state.currentPlaybook : cached,
          );
          const found = existing.some((tr) => tr.taskId === data.taskId);
          const taskResults = found
            ? existing.map((tr) =>
              tr.taskId === data.taskId
                ? {
                  ...clearTaskResultStaleState(tr),
                  status: 'running' as const,
                  output: null,
                  error: null,
                  durationMs: null,
                  startedAt: new Date().toISOString(),
                  completedAt: null,
                }
                : tr,
            )
            : [
              ...existing,
              {
                taskId: data.taskId,
                nodeTitle: '',
                agentName: '',
                order: existing.length,
                status: 'running' as const,
                output: null,
                error: null,
                durationMs: null,
                startedAt: new Date().toISOString(),
                completedAt: null,
                isStale: false,
                staleReason: null,
                invalidatedByTaskId: null,
                semanticMatch: null,
                judgeStatus: 'idle' as const,
                judgeResult: null,
                judgeError: null,
                judgeHistory: [],
                evaluationHistory: [],
                stepExecutions: [],
              } as PlaybookExecution['taskResults'][number],
            ];

          const updatedExec = { ...cached, taskResults, updatedAt: new Date().toISOString() };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution =
            state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;
          const selectedStepId = state.selectedStepId ?? data.taskId;

          return {
            executionCache,
            currentExecution,
            selectedStepId,
            playbooks: updatePlaybookExecutionStatus(state.playbooks, cached.playbookId, 'running'),
          };
        });
      },

      onStepUpdate: (data: PlaybookStepUpdateEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const existing = cached.taskResults;
          const found = existing.some((tr) => tr.taskId === data.taskId);
          const taskResults = found
            ? existing.map((tr) => {
              if (tr.taskId !== data.taskId) return tr;
              const merged = mergeComponents(tr.components, data.components || []);
              return {
                ...tr,
                status: tr.status === 'pending' || tr.status === 'running'
                  ? 'running' as const
                  : tr.status,
                output: data.output ?? tr.output ?? null,
                components: merged,
                toolTrace: data.toolTrace ?? tr.toolTrace ?? [],
                llmPromptTrace: data.llmPromptTrace ?? tr.llmPromptTrace ?? [],
                inputTokens: data.inputTokens ?? tr.inputTokens ?? null,
                outputTokens: data.outputTokens ?? tr.outputTokens ?? null,
                totalTokens: data.totalTokens ?? tr.totalTokens ?? null,
                modelName: data.modelName ?? tr.modelName ?? null,
                traceMetadata: data.traceMetadata ?? tr.traceMetadata ?? null,
                artifacts: data.artifacts ? api.normalizeTaskArtifacts(data.artifacts) : tr.artifacts,
                startedAt: tr.startedAt || new Date().toISOString(),
                completedAt: tr.status === 'pending' || tr.status === 'running' ? null : tr.completedAt,
                durationMs: tr.status === 'pending' || tr.status === 'running' ? null : tr.durationMs,
                error: tr.status === 'pending' || tr.status === 'running' ? null : tr.error,
                isStale: false,
                staleReason: null,
                invalidatedByTaskId: null,
              };
            })
            : [
              ...existing,
              {
                taskId: data.taskId,
                nodeTitle: '',
                agentName: '',
                order: existing.length,
                status: 'running' as const,
                output: data.output ?? null,
                error: null,
                durationMs: null,
                startedAt: new Date().toISOString(),
                completedAt: null,
                components: data.components || [],
                toolTrace: data.toolTrace ?? [],
                llmPromptTrace: data.llmPromptTrace ?? [],
                inputTokens: data.inputTokens ?? null,
                outputTokens: data.outputTokens ?? null,
                totalTokens: data.totalTokens ?? null,
                modelName: data.modelName ?? null,
                traceMetadata: data.traceMetadata ?? null,
                artifacts: api.normalizeTaskArtifacts(data.artifacts),
                judgeStatus: 'idle' as const,
                judgeResult: null,
                judgeError: null,
                judgeHistory: [],
                evaluationHistory: [],
                stepExecutions: [],
                isStale: false,
                staleReason: null,
                invalidatedByTaskId: null,
              } as PlaybookExecution['taskResults'][number],
            ];

          const updatedExec = { ...cached, taskResults, updatedAt: new Date().toISOString() };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution =
            state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;

          return { executionCache, currentExecution };
        });
      },

      onStepComplete: (data: PlaybookStepCompleteEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const existing = cached.taskResults;
          const matchesTargetIteration = (taskResult: PlaybookExecution['taskResults'][number]) => (
            taskResult.taskId === data.taskId
            && (data.iteration === undefined || iterationsMatch(taskResult.iteration, data.iteration))
          );
          const found = existing.some(matchesTargetIteration);
          const taskResults = found
            ? existing.map((tr) => {
              if (!matchesTargetIteration(tr)) return tr;
              const merged = mergeComponents(tr.components, data.components || []);
              const update = {
                status: data.status as any,
                output: data.output || null,
                error: data.error || null,
                durationMs: data.durationMs || null,
                completedAt: new Date().toISOString(),
                artifacts: data.artifacts ? api.normalizeTaskArtifacts(data.artifacts) : tr.artifacts,
                toolTrace: data.toolTrace ?? [],
                reasoningChain: data.reasoningChain ?? [],
                llmPromptTrace: data.llmPromptTrace ?? [],
                inputTokens: data.inputTokens ?? null,
                outputTokens: data.outputTokens ?? null,
                totalTokens: data.totalTokens ?? null,
                modelName: data.modelName ?? null,
                semanticMatch: data.semanticMatch ?? null,
                traceMetadata: data.traceMetadata ?? null,
                judgeStatus: 'idle' as const,
                judgeResult: null,
                judgeError: null,
                iteratorIterations: data.iteratorIterations ?? tr.iteratorIterations ?? [],
                isStale: false,
                staleReason: null,
                invalidatedByTaskId: null,
              };
              return {
                ...tr,
                ...update,
                components: merged,
                judgeHistory: tr.judgeHistory || [],
                evaluationHistory: tr.evaluationHistory || [],
                stepExecutions: tr.stepExecutions || [],
              };
            })
            : [
              ...existing,
              {
                taskId: data.taskId,
                nodeTitle: '',
                agentName: '',
                order: existing.length,
                iteration: data.iteration,
                status: data.status as any,
                output: data.output || null,
                error: data.error || null,
                durationMs: data.durationMs || null,
                startedAt: null,
                completedAt: new Date().toISOString(),
                components: data.components || undefined,
                toolTrace: data.toolTrace ?? [],
                reasoningChain: data.reasoningChain ?? [],
                llmPromptTrace: data.llmPromptTrace ?? [],
                inputTokens: data.inputTokens ?? null,
                outputTokens: data.outputTokens ?? null,
                totalTokens: data.totalTokens ?? null,
                modelName: data.modelName ?? null,
                semanticMatch: data.semanticMatch ?? null,
                traceMetadata: data.traceMetadata ?? null,
                judgeStatus: 'idle' as const,
                judgeResult: null,
                judgeError: null,
                iteratorIterations: data.iteratorIterations ?? [],
                judgeHistory: [],
                evaluationHistory: [],
                stepExecutions: [],
                artifacts: api.normalizeTaskArtifacts(data.artifacts),
                isStale: false,
                staleReason: null,
                invalidatedByTaskId: null,
              } as PlaybookExecution['taskResults'][number],
            ];

          const updatedExec = {
            ...cached,
            status: isActiveExecutionStatus(cached.status) ? cached.status : cached.status,
            taskResults,
            updatedAt: new Date().toISOString(),
          };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution =
            state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;

          return {
            executionCache,
            currentExecution,
            playbooks: isActiveExecutionStatus(cached.status)
              ? updatePlaybookExecutionStatus(state.playbooks, cached.playbookId, cached.status)
              : state.playbooks,
          };
        });

        const cachedExecution = get().executionCache[data.executionId];
        if (cachedExecution?.playbookId) {
          void get().fetchExecution(cachedExecution.playbookId, data.executionId);
        }
      },

      onDynamicReasoningUpdate: (data: DynamicReasoningStreamUpdate) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          const updatedExecution = mergeDynamicReasoningUpdate(cached, data);
          if (!updatedExecution) return state;

          return {
            executionCache: { ...state.executionCache, [data.executionId]: updatedExecution },
            currentExecution: state.currentExecution?.id === data.executionId
              ? updatedExecution
              : state.currentExecution,
          };
        });
      },

      onIteratorChildStepStart: (data: PlaybookIteratorChildStepStartEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const taskResults = mergeIteratorChildTaskResult(cached.taskResults, {
            parentIteratorId: data.parentIteratorId,
            iterationIndex: data.iterationIndex,
            taskId: data.taskId,
            taskTitle: data.taskTitle,
            status: 'running',
          });

          const updatedExec = { ...cached, taskResults, updatedAt: new Date().toISOString() };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution = state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;
          return { executionCache, currentExecution };
        });
      },

      onIteratorChildStepUpdate: (data: PlaybookIteratorChildStepUpdateEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const taskResults = mergeIteratorChildTaskResult(cached.taskResults, {
            parentIteratorId: data.parentIteratorId,
            iterationIndex: data.iterationIndex,
            taskId: data.taskId,
            taskTitle: data.taskTitle,
            status: 'running',
            output: data.output ?? null,
            components: data.components,
            toolTrace: data.toolTrace,
            llmPromptTrace: data.llmPromptTrace,
            artifacts: data.artifacts,
          });

          const updatedExec = { ...cached, taskResults, updatedAt: new Date().toISOString() };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution = state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;
          return { executionCache, currentExecution };
        });
      },

      onIteratorChildStepComplete: (data: PlaybookIteratorChildStepCompleteEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const taskResults = mergeIteratorChildTaskResult(cached.taskResults, {
            parentIteratorId: data.parentIteratorId,
            iterationIndex: data.iterationIndex,
            taskId: data.taskId,
            taskTitle: data.taskTitle,
            status: data.status === 'failed' ? 'failed' : data.status === 'skipped' ? 'skipped' : 'completed',
            output: data.output ?? null,
            error: data.error ?? null,
            components: data.components,
            toolTrace: data.toolTrace,
            reasoningChain: data.reasoningChain,
            llmPromptTrace: data.llmPromptTrace,
            artifacts: data.artifacts,
          });

          const updatedExec = { ...cached, taskResults, updatedAt: new Date().toISOString() };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution = state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;
          return { executionCache, currentExecution };
        });
      },

      onStepEvaluationUpdated: (data: PlaybookStepEvaluationUpdatedEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const taskResults = cached.taskResults.map((tr) =>
            tr.taskId === data.taskId
              ? {
                ...tr,
                semanticMatch: data.semanticMatch ?? null,
                evaluationHistory: appendEvaluationHistory(tr.evaluationHistory, data.evaluationEntry),
              }
              : tr,
          );

          const updatedExec = { ...cached, taskResults, updatedAt: new Date().toISOString() };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution =
            state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;

          return { executionCache, currentExecution };
        });
      },

      onStepJudgeStarted: (data: PlaybookStepJudgeStartedEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const taskResults = cached.taskResults.map((tr) => {
            const isMatch = tr.taskId === data.taskId
              && (data.iteration === undefined || iterationsMatch(tr.iteration, data.iteration));
            return isMatch
              ? {
                  ...tr,
                  judgeStatus: 'evaluating' as const,
                  judgeScoringMode: data.advisorScoringMode ?? tr.judgeScoringMode ?? null,
                  judgeError: null,
                  judgeResult: null,
                }
              : tr;
          });

          const updatedExec = { ...cached, taskResults, updatedAt: new Date().toISOString() };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution = state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;

          return { executionCache, currentExecution };
        });
      },

      onStepJudgeUpdated: (data: PlaybookStepJudgeUpdatedEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const taskResults = cached.taskResults.map((tr) => {
            const isMatch = tr.taskId === data.taskId
              && (data.iteration === undefined || iterationsMatch(tr.iteration, data.iteration));
            return isMatch
              ? {
                  ...tr,
                  judgeStatus: data.judgeStatus,
                  judgeScoringMode: data.advisorScoringMode ?? tr.judgeScoringMode ?? null,
                  judgeResult: data.judgeResult ? api.normalizeJudgeResult(data.judgeResult) : null,
                  judgeError: data.judgeError ?? null,
                  judgeHistory: data.judgeHistoryEntry
                    ? [...(tr.judgeHistory || []), api.normalizeJudgeHistoryEntry(data.judgeHistoryEntry, (tr.judgeHistory || []).length)]
                    : tr.judgeHistory || [],
                }
              : tr;
          });

          const updatedExec = { ...cached, taskResults, updatedAt: new Date().toISOString() };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution = state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;

          return { executionCache, currentExecution };
        });
      },

      onJudgeSummaryUpdated: (data: PlaybookJudgeSummaryUpdatedEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const updatedExec = {
            ...cached,
            judgeSummaryStatus: 'evaluated' as const,
            judgeSummary: data.judgeSummary,
            updatedAt: new Date().toISOString(),
          };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution = state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;

          clearJudgeRefreshTimer(data.executionId);

          return { executionCache, currentExecution };
        });
      },

      onAdvisorAutopilotUpdated: (data: PlaybookAdvisorAutopilotUpdatedEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const taskResults = data.taskId
            ? cached.taskResults.map((tr) =>
              tr.taskId === data.taskId
                ? {
                  ...tr,
                  advisorTurnCount: data.advisorTurnCount ?? tr.advisorTurnCount ?? 0,
                  lastAdvisorAction: data.lastAdvisorAction ?? tr.lastAdvisorAction ?? null,
                  lastAdvisorScoreDelta: data.lastAdvisorScoreDelta ?? tr.lastAdvisorScoreDelta ?? null,
                  advisorStopReason: data.advisorStopReason ?? tr.advisorStopReason ?? null,
                  advisorTurnHistory: data.advisorTurnHistoryEntry
                    ? [...(tr.advisorTurnHistory || []), data.advisorTurnHistoryEntry]
                    : tr.advisorTurnHistory || [],
                  advisorOptimizationHistory: data.advisorOptimizationHistoryEntry
                    ? [...(tr.advisorOptimizationHistory || []), data.advisorOptimizationHistoryEntry]
                    : tr.advisorOptimizationHistory || [],
                }
                : tr,
            )
            : cached.taskResults;

          const updatedExec: PlaybookExecution = {
            ...cached,
            taskResults,
            advisorAutopilotStatus: data.advisorAutopilotStatus ?? cached.advisorAutopilotStatus,
            advisorAutopilotAttemptCount: data.advisorAutopilotAttemptCount ?? cached.advisorAutopilotAttemptCount,
            advisorAutopilotTaskId: data.advisorAutopilotTaskId ?? cached.advisorAutopilotTaskId,
            advisorAutopilotLastError: data.advisorAutopilotLastError ?? cached.advisorAutopilotLastError,
            updatedAt: new Date().toISOString(),
          };

          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution = state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;
          return { executionCache, currentExecution };
        });
      },

      onReplayFormatGuideUpdated: (data: PlaybookReplayFormatGuideUpdatedEvent) => {
        set((state) => ({
          currentPlaybook: state.currentPlaybook?.id === data.playbookId
            ? {
              ...state.currentPlaybook,
              tasks: state.currentPlaybook.tasks.map((task) =>
                task.id === data.taskId
                  ? {
                    ...task,
                    hasValidatedReplay: true,
                    activeReplayId: data.replay.status === 'active' ? data.replay.id : task.activeReplayId,
                    activeReplayVersion: data.replay.status === 'active' ? data.replay.validationVersion : task.activeReplayVersion,
                    activeReplayIsStale: data.replay.isStale || false,
                    activeReplayStaleReasons: data.replay.staleReasons || [],
                    activeReplayPreserveOutputFormat: data.replay.preserveOutputFormat || false,
                    activeReplayFormatGuideStatus: data.replay.formatGuideStatus || 'disabled',
                    activeReplayFormatGuideError: data.replay.formatGuideError || null,
                    hasOutputFormatTemplate: task.hasOutputFormatTemplate,
                    activeOutputFormatTemplateId: task.activeOutputFormatTemplateId,
                    activeOutputFormatTemplateVersion: task.activeOutputFormatTemplateVersion,
                    activeOutputFormatStatus: task.activeOutputFormatStatus || null,
                    activeOutputFormatError: task.activeOutputFormatError || null,
                    isSavingReplayBaseline: false,
                  }
                  : task,
              ),
            }
            : state.currentPlaybook,
        }));
      },

      onOutputFormatTemplateUpdated: (data: PlaybookOutputFormatTemplateUpdatedEvent) => {
        const isActive = data.template.status === 'active';
        set((state) => ({
          currentPlaybook: state.currentPlaybook?.id === data.playbookId
            ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === data.taskId
                    ? {
                        ...task,
                        hasOutputFormatTemplate: isActive,
                        activeOutputFormatTemplateId: isActive ? data.template.id : null,
                        activeOutputFormatTemplateVersion: isActive ? data.template.templateVersion : null,
                        activeOutputFormatStatus: isActive ? data.template.generationStatus : null,
                        activeOutputFormatError: isActive ? (data.template.generationError || null) : null,
                        isCapturingOutputFormat: isActive ? data.template.generationStatus === 'pending' : false,
                      }
                    : task,
                ),
              }
            : state.currentPlaybook,
        }));
      },

      onExecutionComplete: (data: PlaybookExecutionCompleteEvent) => {
        const status = (data.status || 'failed') as ExecutionStatus;
        const cached = get().executionCache[data.executionId];
        const playbookId = cached?.playbookId || get().currentPlaybook?.id;

        const viewAction = playbookId
          ? {
            label: tPlaybook('store.toasts.viewExecution', 'View'),
            onClick: () => {
              // Navigate to the playbook page (in case the user is elsewhere)
              window.location.hash = `#/playbooks/${playbookId}`;
              // Open execution panel after a tick so the canvas page mounts and fetches first
              setTimeout(() => get().viewExecutionInPanel(data.executionId), 0);
            },
          }
          : undefined;

        if (status === 'failed') {
          toast.error(data.error || tPlaybook('store.errors.executionFailed', 'Execution failed. Please try again.'), { action: viewAction });
        } else if (status === 'completed') {
          toast.success(tPlaybook('store.executionCompleted', 'Execution completed successfully.'), { action: viewAction });
        }

        set((state) => {
          const executionHistory = state.executionHistory.map((ex) =>
            ex.id === data.executionId
              ? { ...ex, status, durationMs: data.durationMs || null, error: data.error || null, completedAt: new Date().toISOString() }
              : ex,
          );

          // Remove the playbookId from executingPlaybookIds
          const execPlaybookId = state.executionCache[data.executionId]?.playbookId;
          const executingPlaybookIds = execPlaybookId
            ? state.executingPlaybookIds.filter((pid) => pid !== execPlaybookId)
            : state.executingPlaybookIds;

          // Update cache
          const cachedExec = state.executionCache[data.executionId];
          let executionCache = state.executionCache;
          if (cachedExec) {
            let taskResults = cachedExec.taskResults;
            if (status === 'completed' || status === 'failed' || status === 'cancelled') {
              const terminalTaskStatus = status;
              taskResults = taskResults.map((tr) => (
                tr.status === 'running'
                  ? {
                    ...tr,
                    status: terminalTaskStatus,
                    completedAt: new Date().toISOString(),
                    durationMs: tr.durationMs ?? data.durationMs ?? null,
                    error: status === 'failed' ? (data.error || tr.error || null) : tr.error,
                  }
                  : tr
              ));
            }
            if (data.skippedTaskIds && data.skippedTaskIds.length > 0) {
              const skippedSet = new Set(data.skippedTaskIds);
              taskResults = taskResults.map((tr) =>
                skippedSet.has(tr.taskId) ? { ...tr, status: 'skipped' as const } : tr,
              );
            }
            const updatedExec: PlaybookExecution = {
              ...cachedExec,
              taskResults,
              status,
              durationMs: data.durationMs || null,
              error: data.error || null,
              completedAt: new Date().toISOString(),
              totalInputTokens: data.totalInputTokens ?? cachedExec.totalInputTokens,
              totalOutputTokens: data.totalOutputTokens ?? cachedExec.totalOutputTokens,
              totalTokens: data.totalTokens ?? cachedExec.totalTokens,
              updatedAt: new Date().toISOString(),
            };
            executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          }

          const currentExecution =
            state.currentExecution?.id === data.executionId
              ? executionCache[data.executionId] ?? state.currentExecution
              : state.currentExecution;

          return {
            executionCache,
            currentExecution,
            executionHistory,
            executingPlaybookIds,
            isStopping: false,
            playbooks: execPlaybookId
              ? updatePlaybookExecutionStatus(state.playbooks, execPlaybookId, status)
              : state.playbooks,
          };
        });

        if (playbookId) {
          void get().fetchExecution(playbookId, data.executionId);
        }

        if (status === 'completed' && playbookId) {
          scheduleJudgeRefresh(data.executionId, playbookId);
        } else {
          clearJudgeRefreshTimer(data.executionId);
        }
      },

      onInterrupt: (data: PlaybookInterruptEvent) => {
        const cached = get().executionCache[data.executionId];
        const playbookId = cached?.playbookId || get().currentPlaybook?.id;
        if (cached || (playbookId && get().currentPlaybook?.id === playbookId)) {
          syncUiStoreForInterrupt(data.taskId);
        }
        if (playbookId) {
          // Interrupt SSE payloads can be thinner than the persisted pendingApproval state.
          // Always backfill the latest execution detail so the sidebar has the full interrupt payload.
          setTimeout(() => void get().fetchExecution(playbookId, data.executionId), 0);
        }
        const viewAction = playbookId
          ? {
            label: tPlaybook('store.toasts.viewExecution', 'View'),
            onClick: () => {
              window.location.hash = `#/playbooks/${playbookId}`;
              setTimeout(() => get().viewExecutionInPanel(data.executionId), 0);
            },
          }
          : undefined;
        toast.warning(tPlaybook('store.toasts.interruptAttention', 'A step requires your attention.'), { action: viewAction });

        set((state) => {
          const executionHistory = state.executionHistory.map((ex) =>
            ex.id === data.executionId ? { ...ex, status: 'interrupted' as const } : ex,
          );

          // Remove playbookId from executingPlaybookIds on interrupt
          const execPlaybookId = state.executionCache[data.executionId]?.playbookId;
          const executingPlaybookIds = execPlaybookId
            ? state.executingPlaybookIds.filter((pid) => pid !== execPlaybookId)
            : state.executingPlaybookIds;

          const cachedExec = state.executionCache[data.executionId];
          if (!cachedExec) {
            return {
              executionHistory,
              executingPlaybookIds,
              selectedStepId: data.taskId,
              copilotMode: 'interrupt',
              designerOpen: true,
              executionPanelOpen: true,
              workspaceExplorerOpen: false,
              connectorSidebarOpen: false,
              skillSidebarOpen: false,
              nodeEditorOpen: false,
            };
          }

          // Add humanFeedback component to the interrupted task's components
          const taskResults = cachedExec.taskResults.map((tr) => {
            if (tr.taskId !== data.taskId) return tr;
            const alreadyPending = (tr.components || []).some(
              (c) => c.type === 'humanFeedback' && (c.data as any)?.status === 'pending',
            );
            if (alreadyPending) return { ...tr, status: 'interrupted' as const };
            const feedbackComponent = {
              type: 'humanFeedback' as const,
              data: {
                interruptType: data.type,
                message: data.message,
                status: 'pending',
                interruptId: data.interruptId || '',
                round: data.round || 0,
                payloadJson: data.payloadJson || '',
                resumableActions: data.resumableActions || [],
                taskDescription: data.taskDescription || '',
                result: data.result || '',
                blockerRuleId: data.blockerRuleId,
                blockerKind: data.blockerKind,
                reasonCode: data.reasonCode,
                riskLevel: data.riskLevel,
                downstreamNodeIds: data.downstreamNodeIds,
                feedbackScopeDefault: data.feedbackScopeDefault,
                memoryCandidate: data.memoryCandidate,
                scope: data.feedbackScopeDefault,
              },
            };
            return {
              ...tr,
              status: 'interrupted' as const,
              components: [...(tr.components || []), feedbackComponent],
            };
          });

          const interruptPayload = buildInterruptPayload(data);
          const pendingInterrupts = [
            ...(cachedExec.pendingInterrupts || []).filter((entry) => (
              entry.interruptId !== interruptPayload.interruptId
            )),
            interruptPayload,
          ];
          const activeInterrupt = cachedExec.interruptPayload && cachedExec.waitingForHumanInput
            ? cachedExec.interruptPayload
            : pendingInterrupts[0];
          const updatedExec: PlaybookExecution = {
            ...cachedExec,
            taskResults,
            status: 'interrupted',
            waitingForHumanInput: true,
            currentInterruptId: activeInterrupt?.interruptId || null,
            currentInterruptTaskId: activeInterrupt?.taskId || null,
            pendingInterrupts,
            hitlHistory: [
              ...(cachedExec.hitlHistory || []).filter((entry) => !(entry.status === 'pending' && entry.interruptId === (data.interruptId || ''))),
              {
                interruptId: data.interruptId || '',
                taskId: data.taskId,
                type: data.type,
                taskTitle: '',
                message: data.message,
                taskDescription: data.taskDescription || '',
                result: data.result || '',
                round: data.round || 0,
                payloadJson: data.payloadJson || '',
                resumableActions: data.resumableActions || [],
                status: 'pending',
                responseAction: null,
                responseMessage: null,
                responseApproved: null,
                responseReason: null,
                responseFeedback: null,
                respondedBy: null,
                respondedAt: null,
                createdAt: new Date().toISOString(),
                blockerRuleId: data.blockerRuleId,
                blockerKind: data.blockerKind,
                reasonCode: data.reasonCode,
                riskLevel: data.riskLevel,
                downstreamNodeIds: data.downstreamNodeIds,
                feedbackScopeDefault: data.feedbackScopeDefault,
                memoryCandidate: data.memoryCandidate,
              },
            ],
            interruptPayload: activeInterrupt,
            updatedAt: new Date().toISOString(),
          };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const shouldSetCurrentExecution =
            !state.currentExecution
            || state.currentExecution.id === data.executionId
            || state.currentPlaybook?.id === updatedExec.playbookId;
          const currentExecution = shouldSetCurrentExecution ? updatedExec : state.currentExecution;

          return {
            executionCache,
            currentExecution,
            executionHistory,
            executingPlaybookIds,
            selectedStepId: data.taskId,
            copilotMode: 'interrupt',
            designerOpen: true,
            executionPanelOpen: true,
            workspaceExplorerOpen: false,
            connectorSidebarOpen: false,
            skillSidebarOpen: false,
            nodeEditorOpen: false,
          };
        });
      },

      // ===== Catch-up =====

      hydrateActiveExecutions: (executions: PlaybookExecution[]) => {
        if (executions.length === 0) {
          set((state) => {
            const executionCache = Object.fromEntries(
              Object.entries(state.executionCache).filter(([, execution]) => !isActiveExecutionStatus(execution.status)),
            );

            return {
              executionCache,
              executingPlaybookIds: [],
              currentExecution: state.currentExecution && !isActiveExecutionStatus(state.currentExecution.status)
                ? state.currentExecution
                : null,
            };
          });
          return;
        }
        set((state) => {
          let executionCache = { ...state.executionCache };
          const executingIds = new Set(state.executingPlaybookIds);
          const completedPlaybookIds = new Set<string>();
          let currentExecution = state.currentExecution;

          for (const incoming of executions) {
            const cached = executionCache[incoming.id];

            if (cached) {
              // Smart merge: per task result, keep whichever status is more advanced.
              // This prevents stale DB data from overwriting fresh SSE-based data.
              const cachedMap = new Map(cached.taskResults.map((tr) => [getTaskResultCacheKey(tr), tr]));
              const mergedTaskResults = incoming.taskResults.map((inTr) => {
                const cachedTr = cachedMap.get(getTaskResultCacheKey(inTr));
                if (cachedTr && shouldKeepCachedTaskResult(cachedTr, inTr)) {
                  return cachedTr;
                }
                if (cachedTr) {
                  return mergeRicherIteratorData(cachedTr, inTr);
                }
                return inTr;
              });
              // Include any task results only present in the cache
              for (const [taskResultKey, cachedTr] of cachedMap) {
                if (!mergedTaskResults.some((tr) => getTaskResultCacheKey(tr) === taskResultKey)) {
                  mergedTaskResults.push(cachedTr);
                }
              }
              const mergedStatus = shouldKeepRunningExecution(cached, incoming)
                ? cached.status
                : isNewerStatus(cached.status, incoming.status)
                  ? cached.status : incoming.status;

              executionCache[incoming.id] = {
                ...incoming,
                taskResults: mergedTaskResults,
                status: mergedStatus,
                interruptPayload: isActiveExecutionStatus(mergedStatus) ? cached.interruptPayload || incoming.interruptPayload : null,
                hitlHistory: isActiveExecutionStatus(mergedStatus)
                  ? mergeHitlHistory(cached.hitlHistory || [], incoming.hitlHistory || [])
                  : [],
                pendingInterrupts: isActiveExecutionStatus(mergedStatus)
                  ? ((cached.pendingInterrupts && cached.pendingInterrupts.length > 0) ? cached.pendingInterrupts : incoming.pendingInterrupts)
                  : [],
                currentInterruptId: isActiveExecutionStatus(mergedStatus) ? cached.currentInterruptId ?? incoming.currentInterruptId : null,
                currentInterruptTaskId: isActiveExecutionStatus(mergedStatus) ? cached.currentInterruptTaskId ?? incoming.currentInterruptTaskId : null,
                waitingForHumanInput: isActiveExecutionStatus(mergedStatus) ? Boolean(cached.waitingForHumanInput || incoming.waitingForHumanInput) : false,
              };
            } else {
              // No cached version — use incoming as-is
              executionCache[incoming.id] = incoming;
            }

            const mergedExecution = executionCache[incoming.id];
            if (isActiveExecutionStatus(incoming.status) || isActiveExecutionStatus(mergedExecution.status)) {
              executingIds.add(incoming.playbookId);
            } else {
              completedPlaybookIds.add(incoming.playbookId);
            }
            if (state.currentPlaybook?.id === incoming.playbookId) {
              currentExecution = mergedExecution;
            }
          }

          for (const playbookId of completedPlaybookIds) {
            executingIds.delete(playbookId);
          }

          return {
            executionCache: evictCache(executionCache),
            executingPlaybookIds: [...executingIds],
            currentExecution,
            playbooks: state.playbooks.map((playbook) => {
              const matched = executions.find((execution) => execution.playbookId === playbook.id);
              return matched ? { ...playbook, executionStatus: matched.status } : playbook;
            }),
          };
        });
      },

      // ===== History =====

      fetchExecutions: async (playbookId) => {
        set({ executionsLoading: true });
        try {
          const result = await fetchPlaybookExecutionHistory(playbookId);
          const executions = result.executions.slice(0, MAX_EXECUTION_HISTORY);
          set((state) => ({
            executionHistory: executions,
            executionHistoryByPlaybook: {
              ...state.executionHistoryByPlaybook,
              [playbookId]: executions,
            },
            executionsLoading: false,
          }));

          // Pre-fetch the latest execution's full details into the cache
          // so the canvas can show step statuses from previous runs.
          const latest = executions[0];
          if (latest && !get().executionCache[latest.id]) {
            void get().fetchExecution(playbookId, latest.id).catch(() => { /* non-critical */ });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to fetch executions';
          set({ executionsLoading: false, error: msg });
        }
      },

      fetchExecution: async (playbookId, execId) => {
        // Use cached execution as optimistic value if available
        const cached = get().executionCache[execId];
        set((state) => ({
          currentExecutionLoading: !cached,
          currentExecution: state.currentPlaybook?.id === playbookId || (!state.currentExecution && cached)
            ? (cached || null)
            : state.currentExecution,
          selectedStepId: state.currentPlaybook?.id === playbookId && cached ? state.selectedStepId : state.selectedStepId,
        }));
        try {
          let apiExecution = await fetchPlaybookExecutionDetail(playbookId, execId);
          apiExecution = await hydrateReplayExecutionFromSource(
            apiExecution,
            playbookId,
            get().currentPlaybook?.id === playbookId ? get().currentPlaybook : null,
            get().executionCache,
          );
          const summary = get().executionHistoryByPlaybook[playbookId]?.find((execution) => execution.id === execId)
            ?? get().executionHistory.find((execution) => execution.id === execId);
          const normalizedExecution = summary
            ? {
                ...apiExecution,
                executionNumber: summary.executionNumber,
                executionTrigger: summary.executionTrigger,
                durationMs: summary.durationMs ?? apiExecution.durationMs,
                startedAt: summary.startedAt ?? apiExecution.startedAt,
                completedAt: summary.completedAt ?? apiExecution.completedAt,
              }
            : apiExecution;
          // Smart merge: for each task result, keep the version with the more advanced status
          const latestCached = get().executionCache[execId];
          let merged = normalizedExecution;
          if (latestCached) {
            const cachedResultMap = new Map(latestCached.taskResults.map((tr) => [getTaskResultCacheKey(tr), tr]));
            const mergedTaskResults = normalizedExecution.taskResults.map((apiTr) => {
              const cachedTr = cachedResultMap.get(getTaskResultCacheKey(apiTr));
              if (cachedTr && shouldKeepCachedTaskResult(cachedTr, apiTr)) {
                return cachedTr;
              }
              if (cachedTr) {
                return mergeRicherIteratorData(cachedTr, apiTr);
              }
              return apiTr;
            });
            // Also include any task results from cache that are not in the API response
            for (const [taskResultKey, cachedTr] of cachedResultMap) {
              if (!mergedTaskResults.some((tr) => getTaskResultCacheKey(tr) === taskResultKey)) {
                mergedTaskResults.push(cachedTr);
              }
            }
            // Use the more advanced execution-level status
            const mergedStatus = shouldKeepRunningExecution(latestCached, apiExecution)
              ? latestCached.status
              : isNewerStatus(latestCached.status, normalizedExecution.status)
                ? latestCached.status : normalizedExecution.status;
            merged = {
              ...normalizedExecution,
              taskResults: mergedTaskResults,
              status: mergedStatus,
              singleStepTaskId: latestCached.singleStepTaskId ?? normalizedExecution.singleStepTaskId ?? null,
              interruptPayload: isActiveExecutionStatus(mergedStatus) ? latestCached.interruptPayload || normalizedExecution.interruptPayload : null,
              hitlHistory: isActiveExecutionStatus(mergedStatus)
                ? mergeHitlHistory(latestCached.hitlHistory || [], normalizedExecution.hitlHistory || [])
                : [],
              pendingInterrupts: isActiveExecutionStatus(mergedStatus)
                ? ((latestCached.pendingInterrupts && latestCached.pendingInterrupts.length > 0)
                  ? latestCached.pendingInterrupts
                  : normalizedExecution.pendingInterrupts)
                : [],
              currentInterruptId: isActiveExecutionStatus(mergedStatus) ? latestCached.currentInterruptId ?? normalizedExecution.currentInterruptId : null,
              currentInterruptTaskId: isActiveExecutionStatus(mergedStatus) ? latestCached.currentInterruptTaskId ?? normalizedExecution.currentInterruptTaskId : null,
              waitingForHumanInput: isActiveExecutionStatus(mergedStatus)
                ? Boolean(latestCached.waitingForHumanInput || normalizedExecution.waitingForHumanInput)
                : false,
            };
          }

          const sorted = [...merged.taskResults].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const firstStep = sorted.find((tr) => tr.status === 'running') ?? sorted.find((tr) => tr.status === 'pending') ?? sorted[0];
          const executionCache = { ...get().executionCache, [execId]: merged };
          const executingPlaybookIds = isActiveExecutionStatus(merged.status)
            ? get().executingPlaybookIds
            : get().executingPlaybookIds.filter((pid) => pid !== playbookId);
          set((state) => ({
            currentExecution: state.currentPlaybook?.id === playbookId || !state.currentExecution || state.currentExecution.id === execId
              ? merged
              : state.currentExecution,
            currentExecutionLoading: false,
            executionCache,
            selectedStepId: state.currentPlaybook?.id === playbookId
              ? (state.selectedStepId || firstStep?.taskId || null)
              : state.selectedStepId,
            executingPlaybookIds,
          }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to fetch execution';
          set({ currentExecutionLoading: false, error: msg });
        }
      },

      selectStep: (taskId, iterationIndex) => {
        usePlaybookUiStore.getState().selectStep(taskId, iterationIndex);
        set({ selectedStepId: taskId, selectedIterationIndex: iterationIndex ?? 0 });
      },

      setPageMode: (mode: PlaybookPageMode) =>
        {
          usePlaybookUiStore.getState().setPageMode(mode);
          set({ pageMode: mode });
        },

      // ===== Designer =====

      fetchDesignMessages: async (playbookId) => {
        set({ designMessagesLoading: true });
        try {
          const messages = await fetchDesignMessageList(playbookId);
          set({ designMessages: messages, designMessagesLoading: false });
        } catch {
          set({ designMessagesLoading: false });
        }
      },

      designPlaybook: async (playbookId, data) => {
        get().captureSnapshot();
        set({ isDesigning: true });
        try {
          const result = await api.designPlaybook(playbookId, data);
          if (result.playbook) {
            const layoutedTasks = autoLayoutTasks(result.playbook.tasks, result.playbook.edges);
            const layoutedPlaybook = { ...result.playbook, tasks: layoutedTasks };
            set((state) => ({
              currentPlaybook: layoutedPlaybook,
              designMessages: [...state.designMessages, result.message],
              isDesigning: false,
              isDirty: true,
            }));
            toast.success(tPlaybook('store.toasts.designed', 'Playbook updated by AI'));
          } else {
            // Design failed on the backend — message has status 'failed'
            set((state) => ({
              designMessages: [...state.designMessages, result.message],
              isDesigning: false,
            }));
          }
        } catch (err) {
          set({ isDesigning: false });
          handleApiError(err);
          throw err;
        }
      },

      clearDesignMessages: async (playbookId) => {
        try {
          await api.clearDesignMessages(playbookId);
          playbookQueryClient.setQueryData(playbookKeys.designMessages(playbookId), []);
          set({ designMessages: [] });
          toast.success(tPlaybook('store.toasts.designMemoryCleared', 'Assistant memory cleared'));
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      assessPlaybookIntentDesign: async (playbookId: string, data: RequestPlaybookIntentData) => {
        return api.assessPlaybookIntentDesign(playbookId, data);
      },

      previewAdvisorScriptReplacement: async (playbookId: string, data: AdvisorScriptReplacementRequest) => {
        return api.previewAdvisorScriptReplacement(playbookId, data);
      },

      applyAdvisorScriptReplacement: async (playbookId: string, data: AdvisorScriptReplacementApplyRequest) => {
        const result = await api.applyAdvisorScriptReplacement(playbookId, data);
        await get().fetchPlaybook(playbookId);
        return result;
      },

      revertToSnapshot: async (playbookId, messageId) => {
        try {
          const result = await api.revertToSnapshot(playbookId, messageId);
          set((state) => ({
            currentPlaybook: result.playbook,
            designMessages: [...state.designMessages, result.message],
            isDirty: false,
            undoStack: [],
            redoStack: [],
            perPlaybookUndoHistory: { ...state.perPlaybookUndoHistory, [playbookId]: { undoStack: [], redoStack: [] } },
            canvasSyncVersion: state.canvasSyncVersion + 1,
          }));
          toast.success(tPlaybook('store.toasts.reverted', 'Reverted to snapshot'));
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      setDesignerOpen: (open) => {
        usePlaybookUiStore.getState().setDesignerOpen(open);
        set((state) => ({ designerOpen: open, copilotMode: open ? state.copilotMode : 'design' }));
      },

      setCopilotMode: (mode) => {
        usePlaybookUiStore.getState().setCopilotMode(mode);
        set({ copilotMode: mode });
      },

      setExecutionPanelOpen: (open) => {
        usePlaybookUiStore.getState().setExecutionPanelOpen(open);
        if (open) {
          set({ executionPanelOpen: true, workspaceExplorerOpen: false, connectorSidebarOpen: false, skillSidebarOpen: false, nodeEditorOpen: false });
        } else {
          set({ executionPanelOpen: false });
        }
        persistPanelOpen(open);
      },

      setExecutionDetailTab: (tab) => {
        usePlaybookUiStore.getState().setExecutionDetailTab(tab);
        set({ executionDetailTab: tab });
      },

      openExecutionDetailTab: (tab, taskId) => {
        usePlaybookUiStore.getState().openExecutionDetailTab(tab, taskId);
        const updates: Partial<PlaybookState> = {
          executionDetailTab: tab,
          executionPanelOpen: true,
          workspaceExplorerOpen: false,
          connectorSidebarOpen: false,
          skillSidebarOpen: false,
          nodeEditorOpen: false,
          pageMode: 'run',
        };
        if (taskId) {
          updates.selectedStepId = taskId;
        }
        set(updates);
        persistPanelOpen(true);
      },

      viewExecutionInPanel: (executionId: string) => {
        const cached = get().executionCache[executionId];
        if (cached) {
          const selectedStepId = getPreferredSelectedStepId(cached.taskResults, get().selectedStepId);
          usePlaybookUiStore.getState().openExecutionDetailTab('results', selectedStepId ?? undefined);
          set({
            currentExecution: cached,
            executionPanelOpen: true,
            workspaceExplorerOpen: false,
            connectorSidebarOpen: false,
            skillSidebarOpen: false,
            nodeEditorOpen: false,
            selectedStepId,
            pageMode: 'run',
          });
        } else {
          const playbookId = get().currentPlaybook?.id;
          if (!playbookId) return;
          usePlaybookUiStore.getState().setExecutionPanelOpen(true);
          usePlaybookUiStore.getState().setPageMode('run');
          set({
            executionPanelOpen: true,
            workspaceExplorerOpen: false,
            connectorSidebarOpen: false,
            skillSidebarOpen: false,
            nodeEditorOpen: false,
            pageMode: 'run',
          });
          void get().fetchExecution(playbookId, executionId).then(() => {
            const fetchedExecution = get().executionCache[executionId];
            if (!fetchedExecution) {
              return;
            }
            const selectedStepId = getPreferredSelectedStepId(fetchedExecution.taskResults, get().selectedStepId);
            if (selectedStepId) {
              get().selectStep(selectedStepId);
            }
          });
        }
      },

      // ===== Workspace Explorer =====

      setWorkspaceExplorerOpen: (open) => {
        usePlaybookUiStore.getState().setWorkspaceExplorerOpen(open);
        if (open) {
          set({ workspaceExplorerOpen: true, connectorSidebarOpen: false, skillSidebarOpen: false, executionPanelOpen: false, nodeEditorOpen: false });
        } else {
          set({ workspaceExplorerOpen: false });
        }
        persistWorkspaceExplorerOpen(open);
      },

      addInputFileToTask: (taskId, inputFile) => {
        const { currentPlaybook } = get();
        if (!currentPlaybook) return;
        get().captureSnapshot();
        const updatedTasks = currentPlaybook.tasks.map((task) => {
          if (task.id !== taskId) return task;
          const existing = task.inputFiles ?? [];
          const exists = existing.some((f) =>
            f.id === inputFile.id &&
            f.type === inputFile.type &&
            (!inputFile.portId || f.portId === inputFile.portId),
          );
          if (exists) return task;
          return { ...task, inputFiles: [...existing, inputFile] };
        });
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, tasks: updatedTasks }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      removeInputFileFromTask: (taskId, inputFileId) => {
        const { currentPlaybook } = get();
        if (!currentPlaybook) return;
        get().captureSnapshot();
        const updatedTasks = currentPlaybook.tasks.map((task) => {
          if (task.id !== taskId) return task;
          return { ...task, inputFiles: (task.inputFiles ?? []).filter((f) => f.id !== inputFileId) };
        });
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, tasks: updatedTasks }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      bindResourceToInputPort: (taskId, portId, resource) => {
        const { currentPlaybook } = get();
        if (!currentPlaybook) return;
        get().captureSnapshot();

        const bindingId = `bind-${taskId}-${portId}`;
        const existingBindings = currentPlaybook.dataBindings ?? [];
        const existing = existingBindings.find(
          (b) => b.targetNode === taskId && b.targetPort === portId && b.sourceKind === 'constant',
        );
        const bindingValue = buildResourceBindingValue(resource);

        let updatedBindings: DataBinding[];
        if (existing) {
          const prev = existing.constantValue;
          if (Array.isArray(prev)) {
            const dedupKey = `${resource.kind}:${resource.workspaceId}:${resource.id}`;
            const already = prev.some(
              (r: Record<string, unknown>) => `${r.kind}:${r.workspaceId}:${r.id}` === dedupKey,
            );
            updatedBindings = already
              ? existingBindings
              : existingBindings.map((b) =>
                  b.id === existing.id
                    ? { ...b, constantValue: [...prev, bindingValue] }
                    : b,
                );
          } else {
            updatedBindings = existingBindings.map((b) =>
              b.id === existing.id
                ? { ...b, constantValue: bindingValue }
                : b,
            );
          }
        } else {
          updatedBindings = [
            ...existingBindings,
            {
              id: bindingId,
              targetNode: taskId,
              targetPort: portId,
              sourceKind: 'constant' as const,
              constantValue: bindingValue,
            },
          ];
        }

        const inputFile: import('./types').InputFile = {
          type: resource.kind,
          id: resource.id,
          name: resource.name,
          workspaceId: resource.workspaceId,
          portId,
          metadata: {
            workspaceId: resource.workspaceId,
            documentId: resource.kind === 'document' ? resource.id : undefined,
            filepath: resource.kind === 'document' ? resource.path : undefined,
            folderpath: resource.kind === 'folder' ? resource.path : undefined,
            mimeType: resource.mimeType,
          },
        };
        const updatedTasks = currentPlaybook.tasks.map((task) => {
          if (task.id !== taskId) return task;
          const existingFiles = task.inputFiles ?? [];
          const exists = existingFiles.some((f) => f.id === inputFile.id && f.portId === portId);
          return exists ? task : { ...task, inputFiles: [...existingFiles, inputFile] };
        });

        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, tasks: updatedTasks, dataBindings: updatedBindings }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      removeResourceBinding: (taskId, portId) => {
        const { currentPlaybook } = get();
        if (!currentPlaybook) return;
        get().captureSnapshot();

        const updatedBindings = (currentPlaybook.dataBindings ?? []).filter(
          (b) => !(b.targetNode === taskId && b.targetPort === portId && b.sourceKind === 'constant'),
        );
        const updatedTasks = currentPlaybook.tasks.map((task) => {
          if (task.id !== taskId) return task;
          return { ...task, inputFiles: (task.inputFiles ?? []).filter((f) => f.portId !== portId) };
        });

        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, tasks: updatedTasks, dataBindings: updatedBindings }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      addToolBindingToTask: (taskId: string, binding: ToolBinding) => {
        const { currentPlaybook } = get();
        if (!currentPlaybook) return;
        get().captureSnapshot();
        const updatedTasks = currentPlaybook.tasks.map((task) => {
          if (task.id !== taskId) return task;
          const existing = task.toolBindings ?? [];
          const replaced = existing.filter((b) => b.connectorId !== binding.connectorId);
          return { ...task, toolBindings: [...replaced, binding] };
        });
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, tasks: updatedTasks }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      addSkillBindingToTask: (taskId, binding) => {
        const { currentPlaybook } = get();
        if (!currentPlaybook) return;
        get().captureSnapshot();
        const updatedTasks = currentPlaybook.tasks.map((task) => {
          if (task.id !== taskId) return task;
          const existing = task.skillBindings ?? [];
          const replaced = existing.filter((item) => item.skillId !== binding.skillId);
          return { ...task, skillBindings: [...replaced, binding] };
        });
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, tasks: updatedTasks }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      removeToolBindingFromTask: (taskId: string, bindingId: string) => {
        const { currentPlaybook } = get();
        if (!currentPlaybook) return;
        get().captureSnapshot();
        const updatedTasks = currentPlaybook.tasks.map((task) => {
          if (task.id !== taskId) return task;
          return { ...task, toolBindings: (task.toolBindings ?? []).filter((b) => b.id !== bindingId) };
        });
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, tasks: updatedTasks }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      removeSkillBindingFromTask: (taskId, bindingId) => {
        const { currentPlaybook } = get();
        if (!currentPlaybook) return;
        get().captureSnapshot();
        const updatedTasks = currentPlaybook.tasks.map((task) => {
          if (task.id !== taskId) return task;
          return { ...task, skillBindings: (task.skillBindings ?? []).filter((binding) => binding.id !== bindingId) };
        });
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? { ...state.currentPlaybook, tasks: updatedTasks }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
        }));
      },

      // ===== Connector Sidebar =====

      setConnectorSidebarOpen: (open) => {
        usePlaybookUiStore.getState().setConnectorSidebarOpen(open);
        if (open) {
          set({ connectorSidebarOpen: true, skillSidebarOpen: false, workspaceExplorerOpen: false, executionPanelOpen: false, nodeEditorOpen: false });
        } else {
          set({ connectorSidebarOpen: false });
        }
      },

      setSkillSidebarOpen: (open) => {
        usePlaybookUiStore.getState().setSkillSidebarOpen(open);
        if (open) {
          set({ skillSidebarOpen: true, connectorSidebarOpen: false, workspaceExplorerOpen: false, executionPanelOpen: false, nodeEditorOpen: false });
        } else {
          set({ skillSidebarOpen: false });
        }
      },

      // ===== Node Editor =====

      setNodeEditorOpen: (open) => {
        usePlaybookUiStore.getState().setNodeEditorOpen(open);
        if (open) {
          set({ nodeEditorOpen: true, workspaceExplorerOpen: false, connectorSidebarOpen: false, skillSidebarOpen: false, executionPanelOpen: false });
        } else {
          set({ nodeEditorOpen: false });
        }
      },

      setGraphPanelOpen: (open) => {
        usePlaybookUiStore.getState().setGraphPanelOpen(open);
        set({ graphPanelOpen: open });
      },

      // ===== Undo/Redo =====

      captureSnapshot: () => {
        const { currentPlaybook, undoStack } = get();
        if (!currentPlaybook) return;
        const snapshot: PlaybookUndoSnapshot = {
          tasks: structuredClone(currentPlaybook.tasks),
          edges: structuredClone(currentPlaybook.edges),
          dataBindings: structuredClone(currentPlaybook.dataBindings ?? []),
          name: currentPlaybook.name,
          workspaces: [...currentPlaybook.workspaces],
        };
        const trimmed = undoStack.length >= MAX_UNDO_HISTORY
          ? [...undoStack.slice(undoStack.length - MAX_UNDO_HISTORY + 1), snapshot]
          : [...undoStack, snapshot];
        set({ undoStack: trimmed, redoStack: [] });
      },

      undo: () => {
        const { currentPlaybook, undoStack, redoStack, dirtyVersion, canvasSyncVersion } = get();
        if (undoStack.length === 0 || !currentPlaybook) return;
        const snapshot = undoStack[undoStack.length - 1];
        const currentSnapshot: PlaybookUndoSnapshot = {
          tasks: structuredClone(currentPlaybook.tasks),
          edges: structuredClone(currentPlaybook.edges),
          dataBindings: structuredClone(currentPlaybook.dataBindings ?? []),
          name: currentPlaybook.name,
          workspaces: [...currentPlaybook.workspaces],
        };
        set({
          undoStack: undoStack.slice(0, -1),
          redoStack: [...redoStack, currentSnapshot],
          currentPlaybook: {
            ...currentPlaybook,
            tasks: snapshot.tasks,
            edges: snapshot.edges,
            dataBindings: snapshot.dataBindings,
            name: snapshot.name,
            workspaces: snapshot.workspaces,
          },
          isDirty: true,
          dirtyVersion: dirtyVersion + 1,
          canvasSyncVersion: canvasSyncVersion + 1,
        });
      },

      redo: () => {
        const { currentPlaybook, undoStack, redoStack, dirtyVersion, canvasSyncVersion } = get();
        if (redoStack.length === 0 || !currentPlaybook) return;
        const snapshot = redoStack[redoStack.length - 1];
        const currentSnapshot: PlaybookUndoSnapshot = {
          tasks: structuredClone(currentPlaybook.tasks),
          edges: structuredClone(currentPlaybook.edges),
          dataBindings: structuredClone(currentPlaybook.dataBindings ?? []),
          name: currentPlaybook.name,
          workspaces: [...currentPlaybook.workspaces],
        };
        set({
          undoStack: [...undoStack, currentSnapshot],
          redoStack: redoStack.slice(0, -1),
          currentPlaybook: {
            ...currentPlaybook,
            tasks: snapshot.tasks,
            edges: snapshot.edges,
            dataBindings: snapshot.dataBindings,
            name: snapshot.name,
            workspaces: snapshot.workspaces,
          },
          isDirty: true,
          dirtyVersion: dirtyVersion + 1,
          canvasSyncVersion: canvasSyncVersion + 1,
        });
      },

      clearUndoHistory: () => set((state) => {
        const { currentPlaybook, perPlaybookUndoHistory } = state;
        if (currentPlaybook) {
          perPlaybookUndoHistory[currentPlaybook.id] = { undoStack: [], redoStack: [] };
        }
        return { undoStack: [], redoStack: [], perPlaybookUndoHistory: { ...perPlaybookUndoHistory } };
      }),

      addIntentSuggestionHistoryEntry: (playbookId, playbookName, suggestion, intent) => {
        const { intentSuggestionHistory } = get();
        const existing = intentSuggestionHistory[playbookId] || [];
        const entry: IntentSuggestionHistoryEntry = {
          id: `${Date.now()}-${suggestion.id}-${existing.length}`,
          suggestion,
          appliedAt: Date.now(),
          intent,
          playbookId,
          playbookName,
        };
        const updated = [entry, ...existing].slice(0, MAX_INTENT_HISTORY_PER_PLAYBOOK);
        const nextHistory = { ...intentSuggestionHistory, [playbookId]: updated };
        persistIntentHistory(nextHistory);
        set({ intentSuggestionHistory: nextHistory });
      },

      // ===== Node Templates =====

      fetchNodeTemplates: async () => {
        const { nodeTemplatesLoadedAt } = get();
        const now = Date.now();
        if (now - nodeTemplatesLoadedAt < 30_000) return;

        set({ nodeTemplatesLoading: true });
        try {
          const data = await fetchPlaybookNodeTemplates();
          const items = Array.isArray(data.items) ? data.items : [];

          set({
            nodeTemplates: items.map((item) => ({
              id: item.id,
              key: item.key,
              nodeType: item.nodeType,
              title: item.title,
              description: item.description || '',
              icon: item.icon || 'FileText',
              color: item.color || 'blue',
              category: item.category as TaskTemplate['category'],
              inputPorts: (Array.isArray(item.inputPorts) ? item.inputPorts : []).map((p) => ({
                id: p.id,
                name: p.name,
                artifactKind: p.artifactKind as ArtifactKind,
                required: p.required ?? false,
                description: p.description,
              })),
              outputPorts: (Array.isArray(item.outputPorts) ? item.outputPorts : []).map((p) => ({
                id: p.id,
                name: p.name,
                artifactKind: p.artifactKind as ArtifactKind,
                description: p.description,
              })),
              promptTemplate: item.promptTemplate || '',
              recommendedAgentTypeSlug: item.recommendedAgentTypeSlug,
              requiredToolNames: Array.isArray(item.requiredToolNames) ? item.requiredToolNames : [],
              assignedAgentId: item.assignedAgentId,
              selectedAction: item.selectedAction as 'index' | 'delete' | 'read' | undefined,
              iteratorConfig: item.iteratorConfig ?? null,
              retryPolicy: (item as Record<string, unknown>).retryPolicy as TaskTemplate['retryPolicy'] ?? null,
              modelId: (item as Record<string, unknown>).modelId as string | null ?? null,
            })),
            nodeTemplatesLoading: false,
            nodeTemplatesLoadedAt: now,
          });
        } catch (err) {
          set({ nodeTemplatesLoading: false });
          handleApiError(err, { showToast: true });
        }
      },

      invalidateNodeTemplates: () => {
        set({ nodeTemplatesLoadedAt: 0 });
        void playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.nodeTemplates() });
      },

      // ===== Flow Node Templates (Phase 4) =====

      fetchFlowNodeTemplates: async () => {
        const { flowNodeTemplatesLoadedAt } = get();
        const now = Date.now();
        if (now - flowNodeTemplatesLoadedAt < 30_000) return;

        set({ flowNodeTemplatesLoading: true });
        try {
          const data = await fetchFlowNodeTemplateList();
          const items = Array.isArray(data.items) ? data.items : [];
          set({
            flowNodeTemplates: items.map((item) => ({
              ...item,
              key: item.key,
              nodeType: item.nodeType,
              description: item.description || '',
              icon: item.icon || 'FileText',
              color: item.color || 'blue',
              category: item.category as TaskTemplate['category'],
              inputPorts: Array.isArray(item.inputPorts) ? item.inputPorts : [],
              outputPorts: Array.isArray(item.outputPorts) ? item.outputPorts : [],
              promptTemplate: item.promptTemplate || '',
              requiredToolNames: Array.isArray(item.requiredToolNames) ? item.requiredToolNames : [],
              iteratorConfig: item.iteratorConfig ?? null,
              routerConfig: item.routerConfig ?? null,
              humanApprovalConfig: item.humanApprovalConfig ?? null,
              retryPolicy: item.retryPolicy ?? null,
              modelId: item.modelId ?? null,
            })),
            flowNodeTemplatesLoading: false,
            flowNodeTemplatesLoadedAt: now,
          });
        } catch (err) {
          set({ flowNodeTemplatesLoading: false });
          handleApiError(err, { showToast: true });
        }
      },

      fetchFlowNodeKinds: async () => {
        set({ flowNodeKindsLoading: true });
        try {
          const data = await fetchFlowNodeKindList();
          set({
            flowNodeKinds: Array.isArray(data.kinds) ? data.kinds : [],
            flowNodeKindsLoading: false,
          });
        } catch (err) {
          set({ flowNodeKindsLoading: false });
          handleApiError(err, { showToast: true });
        }
      },

      invalidateFlowNodeTemplates: () => {
        set({ flowNodeTemplatesLoadedAt: 0 });
        void playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.templates() });
      },

      generateIdempotencyKey: (flowId: string) => {
        const state = get();
        const counter = (state.idempotencyKeyCounters[flowId] || 0) + 1;
        const key = `${flowId}-${counter}-${Date.now()}`;
        set({
          idempotencyKeyCounters: {
            ...state.idempotencyKeyCounters,
            [flowId]: counter,
          },
        });
        return key;
      },

      // ===== Flow Evaluation/Repeatability/Trigger Actions (Phase 5) =====

      fetchFlowEvaluationExecutions: async (flowId: string, taskId?: string) => {
        try {
          return await fetchFlowEvaluationExecutionList(flowId, taskId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      fetchFlowEvaluationBaseline: async (flowId: string, taskId: string) => {
        try {
          const baseline = await fetchFlowEvaluationBaselineDetail(flowId, taskId);
          set((state) => ({
            evaluationBaselinesByTask: {
              ...state.evaluationBaselinesByTask,
              [taskId]: baseline,
            },
          }));
          return baseline;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      createFlowEvaluationBaseline: async (flowId: string, taskId: string, executionId: string, iteration?: number) => {
        try {
          const baseline = await api.createFlowEvaluationBaselineFromExecution(flowId, taskId, executionId, iteration);
          set((state) => ({
            evaluationBaselinesByTask: {
              ...state.evaluationBaselinesByTask,
              [taskId]: baseline,
            },
          }));
          return baseline;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      createFlowEvaluationBaselineFromCurrentExecution: async (flowId: string, taskId: string, executionId: string, evaluationExecutionId: string, iteration?: number) => {
        try {
          const baseline = await api.createFlowEvaluationBaselineFromCurrentExecution(flowId, taskId, executionId, evaluationExecutionId, iteration);
          set((state) => ({
            evaluationBaselinesByTask: {
              ...state.evaluationBaselinesByTask,
              [taskId]: baseline,
            },
          }));
          return baseline;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      deleteFlowEvaluationBaseline: async (flowId: string, taskId: string) => {
        try {
          await api.deleteFlowEvaluationBaseline(flowId, taskId);
          set((state) => ({
            evaluationBaselinesByTask: {
              ...state.evaluationBaselinesByTask,
              [taskId]: null,
            },
          }));
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      fetchFlowRepeatability: async (flowId: string) => {
        set({ repeatabilityLoading: true });
        try {
          const result = await fetchFlowRepeatabilitySummary(flowId);
          set({ repeatability: result, repeatabilityLoading: false });
          return result;
        } catch (err) {
          set({ repeatabilityLoading: false });
          handleApiError(err);
          throw err;
        }
      },

      fetchFlowTaskRepeatability: async (flowId: string, taskId: string) => {
        try {
          return await fetchFlowTaskRepeatabilitySummary(flowId, taskId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      fetchFlowTriggers: async (flowId: string) => {
        try {
          return await fetchFlowTriggerList(flowId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      upsertFlowTriggerSchedule: async (flowId: string, data: Record<string, unknown>) => {
        try {
          return playbookFeatures.queryMutationsEnabled
            ? await upsertTriggerScheduleMutation({ flowId, data })
            : await api.upsertFlowTriggerSchedule(flowId, data);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      upsertFlowTriggerMail: async (flowId: string, data: Record<string, unknown>) => {
        try {
          return playbookFeatures.queryMutationsEnabled
            ? await upsertTriggerMailMutation({ flowId, data })
            : await api.upsertFlowTriggerMail(flowId, data);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      syncFlowMailSubscription: async (flowId: string, data: Record<string, unknown>) => {
        try {
          return await api.syncFlowMailSubscription(flowId, data);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },
      // ===== Flow CRUD/Execution/Replay/OutputFormat Actions (Phase 6c) =====

      fetchFlow: async (id: string) => {
        set({ currentPlaybookLoading: true });
        try {
          const flow = await fetchPlaybookDetail(id, 'base');
          const baselineRequestBody = api.buildPlaybookBaselineRequestBody(buildSavePayload(flow as any)) as UpdateFlowData;
          const baselineTelemetry = api.getPlaybookUpdateTelemetry(buildSavePayload(flow as any));
          set((state) => ({
            currentPlaybook: flow as any,
            currentPlaybookLoading: false,
            error: null,
            isDirty: false,
            lastSavedPayloadHashByPlaybookId: {
              ...state.lastSavedPayloadHashByPlaybookId,
              [(flow as any).id]: baselineTelemetry.payloadHash,
            },
            lastSavedRequestBodyByPlaybookId: {
              ...state.lastSavedRequestBodyByPlaybookId,
              [(flow as any).id]: baselineRequestBody,
            },
          }));
          void fetchPlaybookDetail(id, 'enriched')
            .then((enrichedFlow) => {
              set((state) => ({
                currentPlaybook: state.currentPlaybook?.id === id
                  ? {
                    ...state.currentPlaybook,
                    activeReplays: (enrichedFlow as any).activeReplays ?? {},
                  } as any
                  : state.currentPlaybook,
              }));
            })
            .catch(() => undefined);
          return flow;
        } catch (err) {
          set({ currentPlaybookLoading: false });
          handleApiError(err);
          throw err;
        }
      },

      fetchFlows: async (query?: PlaybookQueryParams) => {
        set({ playbooksLoading: true });
        try {
          const result = await fetchFlowList(query);
          set({
            playbooks: result.flows as any,
            playbooksPagination: result.pagination,
            playbooksLoading: false,
            playbooksQuery: query ?? {},
          });
          return result;
        } catch (err) {
          set({ playbooksLoading: false });
          handleApiError(err);
          throw err;
        }
      },

      createFlow: async (data: any) => {
        try {
          const flow = await api.createFlow(data);
          set((state) => ({ playbooks: [flow as any, ...state.playbooks] }));
          return flow;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      updateFlow: async (id: string, data: any, idempotencyKey?: string) => {
        try {
          const flow = await api.updateFlow(id, data, idempotencyKey);
          set((state) => ({
            currentPlaybook: state.currentPlaybook && (state.currentPlaybook as any).id === id ? flow as any : state.currentPlaybook,
            playbooks: state.playbooks.map((p) => ((p as any).id === id ? flow as any : p)),
          }));
          return flow;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      deleteFlow: async (id: string) => {
        try {
          await api.deleteFlow(id);
          set((state) => ({
            playbooks: state.playbooks.filter((p) => (p as any).id !== id),
            currentPlaybook: state.currentPlaybook && (state.currentPlaybook as any).id === id ? null : state.currentPlaybook,
          }));
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      cloneFlow: async (id: string) => {
        try {
          const cloned = await api.cloneFlow(id);
          set((state) => ({ playbooks: [cloned as any, ...state.playbooks] }));
          return cloned;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      startFlowExecutionAction: async (flowId: string, inputContext?: Record<string, unknown>, idempotencyKey?: string, options?: ExecutePlaybookData) => {
        try {
          set((state) => ({
            executingPlaybookIds: [...state.executingPlaybookIds, flowId],
          }));
          const result = playbookFeatures.queryMutationsEnabled
            ? await startExecutionMutation({ flowId, inputContext, idempotencyKey, options })
            : await api.startFlowExecution(flowId, inputContext, idempotencyKey, options);
          return result;
        } catch (err) {
          set((state) => ({
            executingPlaybookIds: state.executingPlaybookIds.filter((id) => id !== flowId),
          }));
          handleApiError(err);
          throw err;
        }
      },

      fetchFlowExecutions: async (flowId: string) => {
        set({ executionsLoading: true });
        try {
          const result = await fetchFlowExecutionHistory(flowId);
          set((state) => ({
            executionHistory: result.executions,
            executionHistoryByPlaybook: {
              ...state.executionHistoryByPlaybook,
              [flowId]: result.executions,
            },
            executionsLoading: false,
          }));
          return result;
        } catch (err) {
          set({ executionsLoading: false });
          handleApiError(err);
          throw err;
        }
      },

      fetchFlowExecution: async (executionId: string) => {
        set({ currentExecutionLoading: true });
        try {
          const execution = await fetchFlowExecutionDetail(executionId);
          set((state) => ({
            currentExecution: execution,
            currentExecutionLoading: false,
            executionCache: { ...state.executionCache, [executionId]: execution },
          }));
          return execution;
        } catch (err) {
          set({ currentExecutionLoading: false });
          handleApiError(err);
          throw err;
        }
      },

      cancelFlowExecutionAction: async (executionId: string) => {
        try {
          if (playbookFeatures.queryMutationsEnabled) {
            await cancelExecutionMutation(executionId);
          } else {
            await api.cancelFlowExecution(executionId);
          }
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      validateFlowTaskReplay: async (flowId: string, taskId: string, data: { executionId: string; iteration?: number; preserveOutputFormat?: boolean }) => {
        try {
          const replay = playbookFeatures.queryMutationsEnabled
            ? await validateFlowReplayMutation({ flowId, taskId, data })
            : await api.validateFlowTaskReplay(flowId, taskId, data);
          invalidateFlowTaskReplayReads(flowId, taskId);
          return replay;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      fetchFlowTaskReplays: async (flowId: string, taskId: string) => {
        try {
          return await fetchFlowTaskReplayList(flowId, taskId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      activateFlowTaskReplay: async (flowId: string, taskId: string, replayId: string) => {
        try {
          const replay = await api.activateFlowTaskReplay(flowId, taskId, replayId);
          invalidateFlowTaskReplayReads(flowId, taskId);
          return replay;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      updateFlowTaskReplayFormatGuide: async (flowId: string, taskId: string, replayId: string, data: { preserveOutputFormat?: boolean; outputFormatGuide?: string }) => {
        try {
          const replay = await api.updateFlowTaskReplayFormatGuide(flowId, taskId, replayId, data);
          invalidateFlowTaskReplayReads(flowId, taskId);
          return replay;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      renameFlowTaskReplay: async (flowId: string, taskId: string, replayId: string, label: string) => {
        try {
          const replay = await api.renameFlowTaskReplay(flowId, taskId, replayId, label);
          invalidateFlowTaskReplayReads(flowId, taskId);
          return replay;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      deleteFlowTaskReplay: async (flowId: string, taskId: string, replayId: string) => {
        try {
          await api.deleteFlowTaskReplay(flowId, taskId, replayId);
          invalidateFlowTaskReplayReads(flowId, taskId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      grabFlowOutputFormatTemplate: async (flowId: string, taskId: string, data: { executionId: string }) => {
        try {
          const template = await api.grabFlowOutputFormatTemplate(flowId, taskId, data);
          invalidateFlowOutputFormatTemplateRead(flowId, taskId);
          return template;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      fetchFlowOutputFormatTemplate: async (flowId: string, taskId: string) => {
        try {
          return await fetchFlowOutputFormatTemplateDetail(flowId, taskId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      updateFlowOutputFormatTemplate: async (flowId: string, taskId: string, data: { formatGuide?: string; preserveOutputFormat?: boolean }) => {
        try {
          const template = playbookFeatures.queryMutationsEnabled
            ? await updateFlowOutputFormatTemplateMutation({ flowId, taskId, data })
            : await api.updateFlowOutputFormatTemplate(flowId, taskId, data);
          invalidateFlowOutputFormatTemplateRead(flowId, taskId);
          return template;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      deleteFlowOutputFormatTemplate: async (flowId: string, taskId: string) => {
        try {
          await api.deleteFlowOutputFormatTemplate(flowId, taskId);
          invalidateFlowOutputFormatTemplateRead(flowId, taskId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      generateFlow: async (data: { name: string; prompt: string; workspaceIds?: string[] }) => {
        try {
          return await api.generateFlow(data);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      designFlow: async (id: string, data: { query: string }) => {
        try {
          return playbookFeatures.queryMutationsEnabled
            ? await designFlowMutation({ flowId: id, data })
            : await api.designFlow(id, data);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      // ===== Port Inspection =====

      openPortInspection: (inspection) => {
        usePlaybookUiStore.getState().openExecutionDetailTab('results', inspection.nodeId);
        set({
          portInspection: inspection,
          executionDetailTab: 'results',
          executionPanelOpen: true,
          workspaceExplorerOpen: false,
          connectorSidebarOpen: false,
          skillSidebarOpen: false,
          nodeEditorOpen: false,
          graphPanelOpen: false,
          selectedStepId: inspection.nodeId,
          pageMode: 'run',
        });
      },
      closePortInspection: () => set({ portInspection: null }),

      importPlaybookDefinition: (definition: PlaybookDefinitionExport) => {
        const { currentPlaybook } = get();
        if (!currentPlaybook) return;
        get().captureSnapshot();
        set((state) => ({
          currentPlaybook: state.currentPlaybook
            ? {
                ...state.currentPlaybook,
                name: definition.name,
                description: definition.description,
                tasks: definition.tasks,
                edges: definition.edges,
                nodes: definition.nodes,
                controlEdges: definition.controlEdges,
                dataBindings: definition.dataBindings,
                settings: definition.settings ?? state.currentPlaybook.settings,
                designSettings: definition.designSettings ?? state.currentPlaybook.designSettings,
                reflectionEnabled: definition.reflectionEnabled ?? state.currentPlaybook.reflectionEnabled,
                advisorScoringMode: definition.advisorScoringMode ?? state.currentPlaybook.advisorScoringMode,
                advisorAutopilotEnabled: definition.advisorAutopilotEnabled ?? state.currentPlaybook.advisorAutopilotEnabled,
                advisorAutopilotTargetScore: definition.advisorAutopilotTargetScore ?? state.currentPlaybook.advisorAutopilotTargetScore,
                advisorAutopilotMaxTurns: definition.advisorAutopilotMaxTurns ?? state.currentPlaybook.advisorAutopilotMaxTurns,
              }
            : null,
          isDirty: true,
          dirtyVersion: state.dirtyVersion + 1,
          canvasSyncVersion: state.canvasSyncVersion + 1,
        }));
        toast.success(tPlaybook('store.toasts.imported', 'Playbook definition imported'));
      },

      // ===== Cleanup =====

      reset: () => {
        deltaAutosaveAvailableInSession = enablePlaybookDeltaAutosave;
        usePlaybookUiStore.getState().reset();
        set(initialState);
      },
    });

export const usePlaybookStore = create<PlaybookStore>()(
  (enablePlaybookDevtools
    ? devtools(createPlaybookStore, { name: 'playbook-store' })
    : createPlaybookStore) as StateCreator<PlaybookStore>,
);

// ===== Selector Hooks =====

export const usePlaybooks = () =>
  usePlaybookStore(useShallow((s) => (s.playbooks?.length ?? 0) > 0 ? s.playbooks : EMPTY_PLAYBOOKS));

export const usePlaybooksLoading = () => usePlaybookStore((s) => s.playbooksLoading);

export const useCurrentPlaybook = () =>
  usePlaybookStore(useShallow((s) => s.currentPlaybook));

export const useCurrentPlaybookLoading = () => usePlaybookStore((s) => s.currentPlaybookLoading);

export const useCurrentExecution = () =>
  usePlaybookStore(useShallow((s) => s.currentExecution));

/** Returns the most recent cached execution for a given playbook (by updatedAt). */
export const useLatestExecutionForPlaybook = (playbookId: string | undefined) =>
  usePlaybookStore(useShallow((s) => {
    if (!playbookId) return null;
    let latest: PlaybookExecution | null = null;
    for (const exec of Object.values(s.executionCache)) {
      if (exec.playbookId !== playbookId) continue;
      if (!latest || exec.updatedAt > latest.updatedAt) latest = exec;
    }
    return latest;
  }));

export const useCurrentExecutionLoading = () => usePlaybookStore((s) => s.currentExecutionLoading);

export const useExecutionHistory = () =>
  usePlaybookStore(useShallow((s) => s.executionHistory.length > 0 ? s.executionHistory : EMPTY_EXECUTIONS));

export const useExecutionHistoryForPlaybook = (playbookId: string | undefined) =>
  usePlaybookStore(useShallow((s) => {
    if (!playbookId) return EMPTY_EXECUTIONS;
    const direct = s.executionHistoryByPlaybook[playbookId];
    if (direct?.length) return direct;
    const filtered = s.executionHistory.filter((execution) => execution.playbookId === playbookId);
    return filtered.length > 0 ? filtered : EMPTY_EXECUTIONS;
  }));

export const useExecutionsLoading = () => usePlaybookStore((s) => s.executionsLoading);

export const useIsExecuting = (playbookId?: string) =>
  usePlaybookStore((s) =>
    playbookId ? s.executingPlaybookIds.includes(playbookId) : s.executingPlaybookIds.length > 0,
  );

export const useExecutingPlaybookIds = () =>
  usePlaybookStore(useShallow((s) => s.executingPlaybookIds));

export const useIsDirty = () => usePlaybookStore((s) => s.isDirty);

export const useDirtyVersion = () => usePlaybookStore((s) => s.dirtyVersion);

export const useIsGenerating = () => usePlaybookStore((s) => s.isGenerating);

export const useIsSaving = () => usePlaybookStore((s) => s.isSaving);

export { useSelectedStep } from './uiStore';

export const usePlaybookError = () => usePlaybookStore((s) => s.error);

export const useDesignMessages = () =>
  usePlaybookStore(useShallow((s) => s.designMessages.length > 0 ? s.designMessages : EMPTY_DESIGN_MESSAGES));

export const useDesignMessagesLoading = () => usePlaybookStore((s) => s.designMessagesLoading);

export const useIsDesigning = () => usePlaybookStore((s) => s.isDesigning);

export const useIsStopping = () => usePlaybookStore((s) => s.isStopping);

export { useDesignerOpen } from './uiStore';

export { useCopilotMode } from './uiStore';

export { useExecutionPanelOpen } from './uiStore';

export { usePageMode } from './uiStore';

export const useHasActiveExecution = (playbookId: string | undefined) =>
  usePlaybookStore((s) => {
    if (!playbookId) return false;
    if (s.executingPlaybookIds.includes(playbookId)) return true;
    return (
      s.executionHistory.some(
        (ex) => ex.playbookId === playbookId && (ex.status === 'running' || ex.status === 'interrupted'),
      ) ||
      (s.currentExecution?.playbookId === playbookId &&
        (s.currentExecution.status === 'running' || s.currentExecution.status === 'interrupted'))
    );
  });

export { useWorkspaceExplorerOpen } from './uiStore';

export const useCanUndo = () => usePlaybookStore((s) => s.undoStack.length > 0);
export const useCanRedo = () => usePlaybookStore((s) => s.redoStack.length > 0);

export const useIntentSuggestionHistory = (playbookId: string | undefined) =>
  usePlaybookStore(useShallow((s) => {
    if (!playbookId) return [];
    const perPlaybook = s.intentSuggestionHistory[playbookId];
    if (perPlaybook && perPlaybook.length > 0) return perPlaybook;
    const all: IntentSuggestionHistoryEntry[] = [];
    for (const entries of Object.values(s.intentSuggestionHistory)) {
      for (const entry of entries) all.push(entry);
    }
    all.sort((a, b) => b.appliedAt - a.appliedAt);
    return all.slice(0, MAX_INTENT_HISTORY_PER_PLAYBOOK);
  }));
