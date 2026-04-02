/**
 * Playbook Store
 * Zustand store for playbook management
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
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
  PlaybookExecution,
  PlaybookExecutionSummary,
  PlaybookExecutionStartEvent,
  PlaybookStepStartEvent,
  PlaybookStepCompleteEvent,
  PlaybookStepEvaluationUpdatedEvent,
  PlaybookReplayFormatGuideUpdatedEvent,
  PlaybookOutputFormatTemplateUpdatedEvent,
  PlaybookExecutionCompleteEvent,
  PlaybookInterruptEvent,
  ExecutionStatus,
  StepEvaluationHistoryEntry,
  PlaybookPageMode,
  PlaybookUndoSnapshot,
} from './types';
import * as api from './api';
import { autoLayoutTasks } from './utils/auto-layout';
import { mergeComponents } from './utils/merge-components';
import { handleApiError } from '@/lib/api-error';
import { i18nInstance } from '@/modules/localization/i18nInstance';

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

const EXEC_PANEL_KEY = 'ys_playbook_exec_panel';
const WORKSPACE_EXPLORER_KEY = 'ys_workspace_explorer_open';

function persistPanelOpen(open: boolean) {
  try { localStorage.setItem(EXEC_PANEL_KEY, open ? '1' : '0'); } catch { /* noop */ }
}

function persistWorkspaceExplorerOpen(open: boolean) {
  try { localStorage.setItem(WORKSPACE_EXPLORER_KEY, open ? '1' : '0'); } catch { /* noop */ }
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
  currentExecution: null,
  currentExecutionLoading: false,
  executionCache: {},
  executionHistory: [],
  executionsLoading: false,
  executingPlaybookIds: [],
  isGenerating: false,
  generateRetryData: null,
  selectedStepId: null,
  error: null,
  designMessages: [],
  designMessagesLoading: false,
  isStopping: false,
  isDesigning: false,
  designerOpen: false,
  copilotMode: 'design',
  executionPanelOpen: (() => { try { return localStorage.getItem(EXEC_PANEL_KEY) === '1'; } catch { return false; } })(),
  workspaceExplorerOpen: (() => { try { return localStorage.getItem(WORKSPACE_EXPLORER_KEY) === '1'; } catch { return false; } })(),
  pageMode: 'design',
  undoStack: [],
  redoStack: [],
  canvasSyncVersion: 0,
};

// ===== Stable empty references =====

const EMPTY_PLAYBOOKS: PlaybookSummary[] = [];
const EMPTY_EXECUTIONS: PlaybookExecutionSummary[] = [];
const EMPTY_DESIGN_MESSAGES: DesignMessage[] = [];
const MAX_EXECUTION_HISTORY = 50;
const MAX_EXECUTION_CACHE = 20;
const MAX_UNDO_HISTORY = 50;

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
  running: 1,
  interrupted: 2,
  completed: 3,
  failed: 3,
  skipped: 3,
  cancelled: 3,
};

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
  const incomingUpdatedAt = toTimestamp(incomingExecution.updatedAt);
  const incomingStartedAt = toTimestamp(incomingExecution.startedAt);
  const incomingCompletedAt = toTimestamp(incomingExecution.completedAt);
  const incomingAttemptTimestamp = Math.max(incomingUpdatedAt, incomingStartedAt, incomingCompletedAt);

  return cachedUpdatedAt > 0 && cachedUpdatedAt > incomingAttemptTimestamp;
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
      evaluationHistory: taskResult.evaluationHistory || [],
      stepExecutions: taskResult.stepExecutions || [],
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
    evaluationHistory: [],
    stepExecutions: [],
  }));
}

// ===== Store Implementation =====

export const usePlaybookStore = create<PlaybookStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ===== CRUD =====

      fetchPlaybooks: async (query) => {
        if (get().playbooksLoading) return;
        const mergedQuery: PlaybookQueryParams = { page: 1, limit: 20, ...query };
        set({ playbooksLoading: true, error: null, playbooksQuery: mergedQuery });
        try {
          const result = await api.getPlaybooks(mergedQuery);
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
          const result = await api.getPlaybooks({ ...playbooksQuery, page: nextPage, limit: playbooksPagination.limit });
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
          const playbook = await api.getPlaybook(id);
          set({ currentPlaybook: playbook, currentPlaybookLoading: false, isDirty: false, undoStack: [], redoStack: [], canvasSyncVersion: 0 });
        } catch (err) {
          const msg = err instanceof Error ? err.message : tPlaybook('store.errors.fetchOneFailed', 'Failed to fetch playbook');
          set({ currentPlaybookLoading: false, error: msg });
        }
      },

      createPlaybook: async (data) => {
        const playbook = await api.createPlaybook(data);
        const summary: PlaybookSummary = {
          id: playbook.id,
          name: playbook.name,
          description: playbook.description,
          taskCount: playbook.tasks.length,
          isFavorite: playbook.isFavorite,
          lastExecutionAt: null,
          createdAt: playbook.createdAt,
          updatedAt: playbook.updatedAt,
        };
        set((state) => ({ playbooks: [summary, ...state.playbooks] }));
        toast.success(tPlaybook('store.toasts.created', 'Playbook created'));
        return playbook;
      },

      generatePlaybook: async (data: GeneratePlaybookData) => {
        set({ isGenerating: true, currentPlaybook: null, currentPlaybookLoading: false, generateRetryData: null, undoStack: [], redoStack: [], canvasSyncVersion: 0 });
        try {
          const result = await api.generatePlaybook(data);
          const playbook = await api.getPlaybook(result.id);
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
        set({
          isSaving: true,
          saveRequestId: requestId,
          savingDirtyVersion: saveStartDirtyVersion,
        });
        try {
          const playbook = await api.updatePlaybook(id, data);
          const existing = get().playbooks.find((p) => p.id === id);
          const summary: PlaybookSummary = {
            id: playbook.id,
            name: playbook.name,
            description: playbook.description,
            taskCount: playbook.tasks.length,
            isFavorite: existing?.isFavorite ?? false,
            lastExecutionAt: existing?.lastExecutionAt ?? null,
            createdAt: playbook.createdAt,
            updatedAt: playbook.updatedAt,
          };
          const latestState = get();
          const isLatestSaveRequest = latestState.saveRequestId === requestId;
          const hasNewerLocalChanges = latestState.dirtyVersion !== saveStartDirtyVersion;

          set((state) => ({
            playbooks: state.playbooks.map((p) => (p.id === id ? summary : p)),
            currentPlaybook: state.currentPlaybook?.id !== id
              ? state.currentPlaybook
              : hasNewerLocalChanges
                ? {
                    ...state.currentPlaybook,
                    updatedAt: playbook.updatedAt,
                    createdAt: playbook.createdAt,
                    name: playbook.name,
                    description: playbook.description,
                    workspaces: playbook.workspaces,
                    isFavorite: playbook.isFavorite,
                    isActive: playbook.isActive,
                    createdBy: playbook.createdBy,
                  }
                : playbook,
            isDirty: hasNewerLocalChanges ? state.isDirty : false,
            isSaving: isLatestSaveRequest ? false : state.isSaving,
            savingDirtyVersion: isLatestSaveRequest ? null : state.savingDirtyVersion,
          }));
        } catch (err) {
          const latestState = get();
          if (latestState.saveRequestId === requestId) {
            set({ isSaving: false, savingDirtyVersion: null });
          }
          const msg = err instanceof Error ? err.message : tPlaybook('store.errors.updateFailed', 'Failed to save');
          toast.error(msg);
        }
      },

      deletePlaybook: async (id) => {
        const previous = get().playbooks;
        set((state) => ({ playbooks: state.playbooks.filter((p) => p.id !== id) }));
        try {
          await api.deletePlaybook(id);
          toast.success(tPlaybook('store.toasts.deleted', 'Playbook deleted'));
        } catch {
          set({ playbooks: previous });
          toast.error(tPlaybook('store.errors.deleteFailed', 'Failed to delete playbook'));
        }
      },

      clonePlaybook: async (id) => {
        const cloned = await api.clonePlaybook(id);
        const summary = {
          id: cloned.id,
          name: cloned.name,
          description: cloned.description,
          taskCount: cloned.tasks.length,
          isFavorite: cloned.isFavorite,
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

      saveCurrentPlaybook: async () => {
        const { currentPlaybook, isSaving } = get();
        if (isSaving) return;
        if (!currentPlaybook) return;
        await get().updatePlaybook(currentPlaybook.id, {
          name: currentPlaybook.name,
          description: currentPlaybook.description,
          tasks: currentPlaybook.tasks,
          edges: currentPlaybook.edges,
          workspaces: currentPlaybook.workspaces,
        });
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
          const result = await api.executePlaybook(id, data);
          set((state) => {
            if (state.currentPlaybook?.id !== id) {
              return state;
            }

            const playbook = state.currentPlaybook;
            const sortedTasks = [...playbook.tasks].sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0));
            const runningTaskId = data?.singleStepTaskId || sortedTasks[0]?.id || null;
            const taskResults = buildExecutionTaskResultsFromTasks(playbook.tasks, {
              runningTaskId,
              markAllPending: !data?.singleStepTaskId,
            });
            const now = new Date().toISOString();
            const optimisticExecution: PlaybookExecution = {
              id: result.executionId,
              playbookId: id,
              executedBy: state.currentExecution?.executedBy || '',
              executionNumber: (state.executionHistory[0]?.executionNumber || 0) + 1,
              status: 'running',
              executionMode: data?.executionMode || 'live',
              replaySourceByTask: null,
              taskResults,
              threadId: null,
              interruptPayload: null,
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
              pageMode: 'run',
            };
          });
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
          await api.stopPlaybook(playbookId, { executionId });
        } catch (err) {
          set({ isStopping: false });
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
          set((state) => {
            const executionHistory = state.executionHistory.filter((ex) => ex.id !== executionId);
            const executionCache = { ...state.executionCache };
            delete executionCache[executionId];

            const currentExecution =
              state.currentExecution?.id === executionId
                ? null
                : state.currentExecution;

            return {
              executionHistory,
              executionCache,
              currentExecution,
              selectedStepId: state.currentExecution?.id === executionId ? null : state.selectedStepId,
              executionPanelOpen: executionHistory.length > 0 ? state.executionPanelOpen : false,
            };
          });
          toast.success(tPlaybook('store.toasts.deleted', 'Execution deleted'));
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      deleteStepExecution: async (playbookId, executionId, taskId, stepExecutionId) => {
        try {
          await api.deleteStepExecution(playbookId, executionId, taskId, stepExecutionId);
          set((state) => {
            const currentExecution = state.executionCache[executionId];
            if (!currentExecution) return state;

            const taskResults = currentExecution.taskResults.map((taskResult) =>
              taskResult.taskId === taskId
                ? {
                    ...taskResult,
                    stepExecutions: (taskResult.stepExecutions || []).filter((entry) => entry.id !== stepExecutionId),
                  }
                : taskResult,
            );

            const updatedExecution = { ...currentExecution, taskResults, updatedAt: new Date().toISOString() };
            const executionCache = { ...state.executionCache, [executionId]: updatedExecution };

            return {
              executionCache,
              currentExecution: state.currentExecution?.id === executionId ? updatedExecution : state.currentExecution,
            };
          });
          toast.success(tPlaybook('store.toasts.deleted', 'Execution deleted'));
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      deleteAllExecutions: async (playbookId) => {
        try {
          const result = await api.deleteAllExecutions(playbookId);
          set((state) => {
            const executionHistory = state.executionHistory.filter(
              (ex) => ex.playbookId !== playbookId || ex.status === 'running' || ex.status === 'interrupted',
            );

            const executionCache = Object.fromEntries(
              Object.entries(state.executionCache).filter(([, execution]) =>
                execution.playbookId !== playbookId || execution.status === 'running' || execution.status === 'interrupted',
              ),
            );

            const keepCurrentExecution = !state.currentExecution
              || state.currentExecution.playbookId !== playbookId
              || state.currentExecution.status === 'running'
              || state.currentExecution.status === 'interrupted';

            const currentExecution = keepCurrentExecution ? state.currentExecution : null;
            const hasRemainingForPlaybook = executionHistory.some((ex) => ex.playbookId === playbookId)
              || currentExecution?.playbookId === playbookId;

            return {
              executionHistory,
              executionCache,
              currentExecution,
              selectedStepId: keepCurrentExecution ? state.selectedStepId : null,
              executionPanelOpen: hasRemainingForPlaybook ? state.executionPanelOpen : false,
            };
          });

          if (result.kept > 0) {
            toast.success(tPlaybook('store.toasts.deletedAllExecutions', 'Executions deleted'), {
              description: `${result.deleted} deleted, ${result.kept} active execution(s) kept.`,
            });
          } else {
            toast.success(tPlaybook('store.toasts.deletedAllExecutions', 'Executions deleted'));
          }
        } catch (err) {
          handleApiError(err);
          throw err;
        }
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
          const replay = await api.validateTaskReplay(playbookId, taskId, {
            executionId,
            preserveOutputFormat: options?.preserveOutputFormat || false,
          });
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

      fetchTaskReplays: async (playbookId, taskId) => {
        try {
          return await api.getTaskReplays(playbookId, taskId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      activateTaskReplay: async (playbookId, taskId, replayId) => {
        try {
          const replay = await api.activateTaskReplay(playbookId, taskId, replayId);
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
          toast.success(tPlaybook('store.toasts.saved', 'Replay baseline activated'));
          return replay;
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      updateTaskReplayFormatGuide: async (playbookId, taskId, replayId, data) => {
        try {
          const replay = await api.updateTaskReplayFormatGuide(playbookId, taskId, replayId, data);
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
          return await api.getOutputFormatTemplate(playbookId, taskId);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      updateOutputFormatTemplate: async (playbookId, taskId, data) => {
        try {
          const template = await api.updateOutputFormatTemplate(playbookId, taskId, data);
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

      resumeExecution: async (id, data) => {
        const action = data.action || (data.approved === true ? 'approve' : data.feedback || data.message ? 'reply' : 'reject');
        const message = data.message || data.feedback || data.reason || '';
        // Optimistically mark the humanFeedback component as answered
        set((state) => {
          if (!state.currentExecution) return state;
          const taskResults = state.currentExecution.taskResults.map((tr) => {
            if (tr.taskId !== data.taskId) return tr;
            const components = (tr.components || []).map((comp) => {
              if (comp.type === 'humanFeedback' && (comp.data as any)?.status === 'pending') {
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
                    humanResponse: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action,
                  },
                };
              }
              return comp;
            });
            return { ...tr, components };
          });
          const updatedExec: PlaybookExecution = {
            ...state.currentExecution,
            taskResults,
            status: 'running',
            interruptPayload: null,
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
          await api.resumePlaybook(id, data);
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      rerunStepInExecution: async (playbookId, executionId, taskId, runEvaluation = false, executionMode = 'live') => {
        set((state) => {
          const cachedExecution = state.executionCache[executionId];
          const updatedExecution = cachedExecution
            ? {
                ...cachedExecution,
                status: 'running' as const,
                interruptPayload: null,
                taskResults: buildResumeFromStepTaskResults(cachedExecution.taskResults, taskId),
                updatedAt: new Date().toISOString(),
              }
            : null;
          const executionCache = updatedExecution
            ? { ...state.executionCache, [executionId]: updatedExecution }
            : state.executionCache;

          return {
            executingPlaybookIds: state.executingPlaybookIds.includes(playbookId)
              ? state.executingPlaybookIds
              : [...state.executingPlaybookIds, playbookId],
            error: null,
            executionCache,
            currentExecution: state.currentExecution?.id === executionId
              ? updatedExecution ?? state.currentExecution
              : state.currentExecution,
            selectedStepId: updatedExecution ? taskId : state.selectedStepId,
          };
        });
        try {
          await api.rerunPlaybookStep(playbookId, executionId, { taskId, runEvaluation, executionMode });
          await Promise.all([
            get().fetchExecution(playbookId, executionId),
            get().fetchExecutions(playbookId),
          ]);
        } catch (err) {
          set((state) => ({
            executingPlaybookIds: state.executingPlaybookIds.filter((pid) => pid !== playbookId),
          }));
          handleApiError(err);
          throw err;
        }
      },

      resumeFromStep: async (playbookId, executionId, taskId) => {
        set((state) => {
          const cachedExecution = state.executionCache[executionId];
          const updatedExecution = cachedExecution
            ? {
                ...cachedExecution,
                status: 'running' as const,
                interruptPayload: null,
                taskResults: buildResumeFromStepTaskResults(cachedExecution.taskResults, taskId),
                updatedAt: new Date().toISOString(),
              }
            : null;
          const executionCache = updatedExecution
            ? { ...state.executionCache, [executionId]: updatedExecution }
            : state.executionCache;

          return {
            executingPlaybookIds: state.executingPlaybookIds.includes(playbookId)
              ? state.executingPlaybookIds
              : [...state.executingPlaybookIds, playbookId],
            error: null,
            executionCache,
            currentExecution: state.currentExecution?.id === executionId
              ? updatedExecution ?? state.currentExecution
              : state.currentExecution,
            selectedStepId: updatedExecution ? taskId : state.selectedStepId,
          };
        });
        try {
          await api.resumePlaybookFromStep(playbookId, executionId, { taskId });
          await Promise.all([
            get().fetchExecution(playbookId, executionId),
            get().fetchExecutions(playbookId),
          ]);
        } catch (err) {
          set((state) => ({
            executingPlaybookIds: state.executingPlaybookIds.filter((pid) => pid !== playbookId),
          }));
          handleApiError(err);
          throw err;
        }
      },

      // ===== SSE Handlers =====

      onExecutionStart: (data: PlaybookExecutionStartEvent) => {
        const taskResults = data.taskResults ?? [];
        const newExecution: PlaybookExecution = {
          id: data.executionId,
          playbookId: data.playbookId,
          executedBy: '',
          executionNumber: data.executionNumber,
          status: data.status as any,
          executionMode: data.executionMode || 'live',
          replaySourceByTask: data.replaySourceByTask || null,
          taskResults,
          threadId: null,
          interruptPayload: null,
          error: null,
          durationMs: null,
          startedAt: new Date().toISOString(),
          completedAt: null,
          singleStepTaskId: null,
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
          error: null,
          durationMs: null,
          startedAt: new Date().toISOString(),
          completedAt: null,
          singleStepTaskId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        // Auto-select the first pending task (lowest order)
        const sorted = [...taskResults].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const firstStep = sorted.find((tr) => tr.status === 'running') ?? sorted.find((tr) => tr.status === 'pending') ?? sorted[0];
        set((state) => {
          const executionCache = evictCache({ ...state.executionCache, [data.executionId]: newExecution });
          // Only replace currentExecution if the user is viewing this playbook
          const shouldSetCurrent =
            state.currentPlaybook?.id === data.playbookId;
          return {
            executingPlaybookIds: state.executingPlaybookIds.includes(data.playbookId)
              ? state.executingPlaybookIds
              : [...state.executingPlaybookIds, data.playbookId],
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

          const existing = cached.taskResults;
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
                },
              ];

          const updatedExec = { ...cached, taskResults, updatedAt: new Date().toISOString() };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution =
            state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;
          const selectedStepId = state.selectedStepId ?? data.taskId;

          return { executionCache, currentExecution, selectedStepId };
        });
      },

      onStepComplete: (data: PlaybookStepCompleteEvent) => {
        set((state) => {
          const cached = state.executionCache[data.executionId];
          if (!cached) return state;

          const existing = cached.taskResults;
          const found = existing.some((tr) => tr.taskId === data.taskId);
          const update = {
            status: data.status as any,
            output: data.output || null,
            error: data.error || null,
            durationMs: data.durationMs || null,
            completedAt: new Date().toISOString(),
            toolTrace: data.toolTrace ?? [],
            llmPromptTrace: data.llmPromptTrace ?? [],
            inputTokens: data.inputTokens ?? null,
            outputTokens: data.outputTokens ?? null,
            totalTokens: data.totalTokens ?? null,
            modelName: data.modelName ?? null,
            semanticMatch: data.semanticMatch ?? null,
            artifacts: data.artifacts ?? undefined,
            isStale: false,
            staleReason: null,
            invalidatedByTaskId: null,
          };
          const taskResults = found
            ? existing.map((tr) => {
                if (tr.taskId !== data.taskId) return tr;
                const merged = mergeComponents(tr.components, data.components || []);
                return {
                  ...tr,
                  ...update,
                  components: merged,
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
                  startedAt: null,
                  components: data.components || undefined,
                  evaluationHistory: [],
                  stepExecutions: [],
                  ...update,
                },
              ];

          const updatedExec = { ...cached, taskResults, updatedAt: new Date().toISOString() };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution =
            state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;

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
        set((state) => ({
          currentPlaybook: state.currentPlaybook?.id === data.playbookId
            ? {
                ...state.currentPlaybook,
                tasks: state.currentPlaybook.tasks.map((task) =>
                  task.id === data.taskId
                    ? {
                        ...task,
                        hasOutputFormatTemplate: true,
                        activeOutputFormatTemplateId: data.template.id,
                        activeOutputFormatTemplateVersion: data.template.templateVersion,
                        activeOutputFormatStatus: data.template.generationStatus,
                        activeOutputFormatError: data.template.generationError || null,
                        isCapturingOutputFormat: data.template.generationStatus === 'pending',
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
          };
        });
      },

      onInterrupt: (data: PlaybookInterruptEvent) => {
        const cached = get().executionCache[data.executionId];
        const playbookId = cached?.playbookId || get().currentPlaybook?.id;
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
            return { executionHistory, executingPlaybookIds };
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
              },
            };
            return {
              ...tr,
              status: 'interrupted' as const,
              components: [...(tr.components || []), feedbackComponent],
            };
          });

          const updatedExec: PlaybookExecution = {
            ...cachedExec,
            taskResults,
            status: 'interrupted',
            interruptPayload: {
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
            },
            updatedAt: new Date().toISOString(),
          };
          const executionCache = { ...state.executionCache, [data.executionId]: updatedExec };
          const currentExecution =
            state.currentExecution?.id === data.executionId ? updatedExec : state.currentExecution;

          return {
            executionCache,
            currentExecution,
            executionHistory,
            executingPlaybookIds,
            selectedStepId: data.taskId,
            copilotMode: 'interrupt',
            designerOpen: true,
            executionPanelOpen: true,
          };
        });
      },

      // ===== Catch-up =====

      hydrateActiveExecutions: (executions: PlaybookExecution[]) => {
        if (executions.length === 0) return;
        set((state) => {
          let executionCache = { ...state.executionCache };
          const executingIds = new Set(state.executingPlaybookIds);
          let currentExecution = state.currentExecution;

          for (const incoming of executions) {
            const cached = executionCache[incoming.id];

            if (cached) {
              // Smart merge: per task result, keep whichever status is more advanced.
              // This prevents stale DB data from overwriting fresh SSE-based data.
              const cachedMap = new Map(cached.taskResults.map((tr) => [tr.taskId, tr]));
              const mergedTaskResults = incoming.taskResults.map((inTr) => {
                const cachedTr = cachedMap.get(inTr.taskId);
                if (cachedTr && shouldKeepCachedTaskResult(cachedTr, inTr)) {
                  return cachedTr;
                }
                return inTr;
              });
              // Include any task results only present in the cache
              for (const [taskId, cachedTr] of cachedMap) {
                if (!mergedTaskResults.some((tr) => tr.taskId === taskId)) {
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
                interruptPayload: cached.interruptPayload || incoming.interruptPayload,
              };
            } else {
              // No cached version — use incoming as-is
              executionCache[incoming.id] = incoming;
            }

            if (incoming.status === 'running' || executionCache[incoming.id].status === 'running') {
              executingIds.add(incoming.playbookId);
            }
            if (state.currentPlaybook?.id === incoming.playbookId) {
              currentExecution = executionCache[incoming.id];
            }
          }

          return {
            executionCache: evictCache(executionCache),
            executingPlaybookIds: [...executingIds],
            currentExecution,
          };
        });
      },

      // ===== History =====

      fetchExecutions: async (playbookId) => {
        set({ executionsLoading: true });
        try {
          const result = await api.getExecutions(playbookId);
          const executions = result.executions.slice(0, MAX_EXECUTION_HISTORY);
          set({ executionHistory: executions, executionsLoading: false });

          // Pre-fetch the latest execution's full details into the cache
          // so the canvas can show step statuses from previous runs.
          const latest = executions[0];
          if (latest && !get().executionCache[latest.id]) {
            api.getExecution(playbookId, latest.id).then((execution) => {
              set((state) => ({
                executionCache: evictCache({ ...state.executionCache, [execution.id]: execution }),
              }));
            }).catch(() => { /* non-critical */ });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to fetch executions';
          set({ executionsLoading: false, error: msg });
        }
      },

      fetchExecution: async (playbookId, execId) => {
        // Use cached execution as optimistic value if available
        const cached = get().executionCache[execId];
        set({
          currentExecutionLoading: !cached,
          currentExecution: cached || null,
          selectedStepId: cached ? get().selectedStepId : null,
        });
        try {
          const apiExecution = await api.getExecution(playbookId, execId);
          // Smart merge: for each task result, keep the version with the more advanced status
          const latestCached = get().executionCache[execId];
          let merged = apiExecution;
          if (latestCached) {
            const cachedResultMap = new Map(latestCached.taskResults.map((tr) => [tr.taskId, tr]));
            const mergedTaskResults = apiExecution.taskResults.map((apiTr) => {
              const cachedTr = cachedResultMap.get(apiTr.taskId);
              if (cachedTr && shouldKeepCachedTaskResult(cachedTr, apiTr)) {
                return cachedTr;
              }
              return apiTr;
            });
            // Also include any task results from cache that are not in the API response
            for (const [taskId, cachedTr] of cachedResultMap) {
              if (!mergedTaskResults.some((tr) => tr.taskId === taskId)) {
                mergedTaskResults.push(cachedTr);
              }
            }
            // Use the more advanced execution-level status
            const mergedStatus = shouldKeepRunningExecution(latestCached, apiExecution)
              ? latestCached.status
              : isNewerStatus(latestCached.status, apiExecution.status)
              ? latestCached.status : apiExecution.status;
            merged = {
              ...apiExecution,
              taskResults: mergedTaskResults,
              status: mergedStatus,
              interruptPayload: latestCached.interruptPayload || apiExecution.interruptPayload,
            };
          }

          const sorted = [...merged.taskResults].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const firstStep = sorted.find((tr) => tr.status === 'running') ?? sorted.find((tr) => tr.status === 'pending') ?? sorted[0];
          const executionCache = { ...get().executionCache, [execId]: merged };
          set({
            currentExecution: merged,
            currentExecutionLoading: false,
            executionCache,
            selectedStepId: get().selectedStepId || firstStep?.taskId || null,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to fetch execution';
          set({ currentExecutionLoading: false, error: msg });
        }
      },

      selectStep: (taskId) => set({ selectedStepId: taskId }),

      setPageMode: (mode: PlaybookPageMode) =>
        set({ pageMode: mode }),

      // ===== Designer =====

      fetchDesignMessages: async (playbookId) => {
        set({ designMessagesLoading: true });
        try {
          const messages = await api.getDesignMessages(playbookId);
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

      revertToSnapshot: async (playbookId, messageId) => {
        try {
          const result = await api.revertToSnapshot(playbookId, messageId);
          set((state) => ({
            currentPlaybook: result.playbook,
            designMessages: [...state.designMessages, result.message],
            isDirty: false,
            undoStack: [],
            redoStack: [],
            canvasSyncVersion: state.canvasSyncVersion + 1,
          }));
          toast.success(tPlaybook('store.toasts.reverted', 'Reverted to snapshot'));
        } catch (err) {
          handleApiError(err);
          throw err;
        }
      },

      setDesignerOpen: (open) => set((state) => ({ designerOpen: open, copilotMode: open ? state.copilotMode : 'design' })),

      setCopilotMode: (mode) => set({ copilotMode: mode }),

      setExecutionPanelOpen: (open) => {
        set({ executionPanelOpen: open });
        persistPanelOpen(open);
      },

      viewExecutionInPanel: (executionId: string) => {
        const cached = get().executionCache[executionId];
        if (cached) {
          const selectedStepId = getPreferredSelectedStepId(cached.taskResults, get().selectedStepId);
          set({
            currentExecution: cached,
            executionPanelOpen: true,
            selectedStepId,
            pageMode: 'run',
          });
        } else {
          // Fetch from API — need the playbookId
          const playbookId = get().currentPlaybook?.id;
          if (!playbookId) return;
          set({
            executionPanelOpen: true,
            pageMode: 'run',
          });
          get().fetchExecution(playbookId, executionId);
        }
      },

      // ===== Workspace Explorer =====

      setWorkspaceExplorerOpen: (open) => {
        set({ workspaceExplorerOpen: open });
        persistWorkspaceExplorerOpen(open);
      },

      addInputFileToTask: (taskId, inputFile) => {
        const { currentPlaybook } = get();
        if (!currentPlaybook) return;
        get().captureSnapshot();
        const updatedTasks = currentPlaybook.tasks.map((task) => {
          if (task.id !== taskId) return task;
          const existing = task.inputFiles ?? [];
          const exists = existing.some((f) => f.id === inputFile.id && f.type === inputFile.type);
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

      // ===== Undo/Redo =====

      captureSnapshot: () => {
        const { currentPlaybook, undoStack } = get();
        if (!currentPlaybook) return;
        const snapshot: PlaybookUndoSnapshot = {
          tasks: structuredClone(currentPlaybook.tasks),
          edges: structuredClone(currentPlaybook.edges),
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
            name: snapshot.name,
            workspaces: snapshot.workspaces,
          },
          isDirty: true,
          dirtyVersion: dirtyVersion + 1,
          canvasSyncVersion: canvasSyncVersion + 1,
        });
      },

      clearUndoHistory: () => set({ undoStack: [], redoStack: [] }),

      // ===== Cleanup =====

      reset: () => set(initialState),
    }),
    { name: 'playbook-store' },
  ),
);

// ===== Selector Hooks =====

export const usePlaybooks = () =>
  usePlaybookStore(useShallow((s) => s.playbooks.length > 0 ? s.playbooks : EMPTY_PLAYBOOKS));

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

export const useSelectedStep = () => usePlaybookStore((s) => s.selectedStepId);

export const usePlaybookError = () => usePlaybookStore((s) => s.error);

export const useDesignMessages = () =>
  usePlaybookStore(useShallow((s) => s.designMessages.length > 0 ? s.designMessages : EMPTY_DESIGN_MESSAGES));

export const useDesignMessagesLoading = () => usePlaybookStore((s) => s.designMessagesLoading);

export const useIsDesigning = () => usePlaybookStore((s) => s.isDesigning);

export const useIsStopping = () => usePlaybookStore((s) => s.isStopping);

export const useDesignerOpen = () => usePlaybookStore((s) => s.designerOpen);

export const useCopilotMode = () => usePlaybookStore((s) => s.copilotMode);

export const useExecutionPanelOpen = () => usePlaybookStore((s) => s.executionPanelOpen);

export const usePageMode = () => usePlaybookStore((s) => s.pageMode);

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

export const useWorkspaceExplorerOpen = () => usePlaybookStore((s) => s.workspaceExplorerOpen);

export const useCanUndo = () => usePlaybookStore((s) => s.undoStack.length > 0);
export const useCanRedo = () => usePlaybookStore((s) => s.redoStack.length > 0);
