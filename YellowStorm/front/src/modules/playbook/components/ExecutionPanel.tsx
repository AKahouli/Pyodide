import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Clock, Square, ChevronDown, History, GitCompareArrows, PanelRightClose, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlaybookStatusBadge } from './PlaybookStatusBadge';
import { ExecutionStepList } from './ExecutionStepList';
import { ExecutionStepDetail } from './ExecutionStepDetail';
import {
  usePlaybookStore,
  useCurrentExecution,
  useCurrentPlaybook,
  useSelectedStep,
  useExecutionHistory,
  useIsStopping,
  useIsExecuting,
} from '../store';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookPageMode } from '../types';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function getExecutionModeLabel(
  mode: string | undefined,
  t: (key: 'execution.mode.live' | 'execution.mode.replayStrict' | 'execution.mode.replayFlex' | 'execution.mode.replayAdaptive') => string,
): string {
  if (mode === 'replay_strict') return t('execution.mode.replayStrict');
  if (mode === 'replay_flex') return t('execution.mode.replayFlex');
  if (mode === 'replay_adaptive') return t('execution.mode.replayAdaptive');
  return t('execution.mode.live');
}

const SIDEBAR_DEFAULT_WIDTH_RATIO = 0.5;
const SIDEBAR_MIN_WIDTH = 360;
const SIDEBAR_MAX_WIDTH_RATIO = 0.8;
const EXECUTION_PANEL_WIDTH_KEY = 'ys_playbook_execution_panel_width';

function readSidebarWidthFallback(): number {
  if (typeof window === 'undefined') return 640;
  try {
    const stored = window.localStorage.getItem(EXECUTION_PANEL_WIDTH_KEY);
    const parsed = stored ? Number(stored) : Number.NaN;
    if (Number.isFinite(parsed)) {
      const maxWidth = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
      return Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, parsed));
    }
  } catch {
    // Ignore storage access errors and fall back to the viewport default.
  }
  return Math.floor(window.innerWidth * SIDEBAR_DEFAULT_WIDTH_RATIO);
}

function ExecutionHistoryPicker({
  currentExecutionId,
  label,
  baselineExecutionId,
}: {
  currentExecutionId?: string;
  label: string;
  baselineExecutionId?: string | null;
}) {
  const history = useExecutionHistory();
  const viewExecutionInPanel = usePlaybookStore((s) => s.viewExecutionInPanel);

  if (history.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2">
          <History className="h-3 w-3 mr-1" />
          {label}
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px] p-0">
        <ScrollArea className="h-72">
          <div className="p-1">
            {history.map((exec) => (
              <DropdownMenuItem
                key={exec.id}
                className={`cursor-pointer ${exec.id === currentExecutionId ? 'bg-accent' : ''}`}
                onClick={() => viewExecutionInPanel(exec.id)}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-sm">#{exec.executionNumber}</span>
                  <div className="flex items-center gap-2">
                    {baselineExecutionId === exec.id && (
                      <span className="rounded-full border border-amber-500/30 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        Baseline
                      </span>
                    )}
                    <PlaybookStatusBadge status={exec.status} size="sm" />
                    <span className="text-xs text-muted-foreground">
                      {new Date(exec.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shared header actions: Compare, History picker, Close */
function PanelHeaderActions({
  compareUrl,
  historyPickerLabel,
  currentExecutionId,
  baselineExecutionId,
  onDeleteCurrentExecution,
  canDeleteCurrentExecution,
  onDeleteAll,
  canDeleteAll,
  onCollapse,
}: {
  compareUrl: string | null;
  historyPickerLabel: string;
  currentExecutionId?: string;
  baselineExecutionId?: string | null;
  onDeleteCurrentExecution?: () => void;
  canDeleteCurrentExecution?: boolean;
  onDeleteAll?: () => void;
  canDeleteAll?: boolean;
  onCollapse?: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('playbook');
  const history = useExecutionHistory();
  const setExecutionPanelOpen = usePlaybookStore((s) => s.setExecutionPanelOpen);

  return (
    <div className="flex items-center gap-1">
      {history.length >= 2 && compareUrl && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={() => navigate(compareUrl)}
          title={t('compare.compare')}
        >
          <GitCompareArrows className="h-3 w-3 mr-1" />
          <span className="hidden sm:inline">{t('compare.compare')}</span>
        </Button>
      )}
      {canDeleteAll && onDeleteAll && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2 text-destructive"
          onClick={onDeleteAll}
          title="Delete all executions"
        >
          <Trash2 className="h-3 w-3 mr-1" />
          <span className="hidden sm:inline">Delete All</span>
        </Button>
      )}
      {canDeleteCurrentExecution && onDeleteCurrentExecution && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2 text-destructive"
          onClick={onDeleteCurrentExecution}
          title={t('execution.deleteSelected')}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          <span className="hidden sm:inline">{t('execution.delete')}</span>
        </Button>
      )}
      <ExecutionHistoryPicker
        currentExecutionId={currentExecutionId}
        label={historyPickerLabel}
        baselineExecutionId={baselineExecutionId}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => {
          onCollapse?.();
          setExecutionPanelOpen(false);
        }}
        title="Collapse sidebar"
        aria-label="Collapse sidebar"
      >
        <PanelRightClose className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

interface ExecutionPanelProps {
  pageMode?: PlaybookPageMode;
  onOpenOutputFormatEditor?: (taskId: string) => void;
  onCollapse?: () => void;
}

export function ExecutionPanel({ pageMode = 'run', onOpenOutputFormatEditor, onCollapse }: ExecutionPanelProps) {
  const { t } = useModuleTranslation('playbook');
  const execution = useCurrentExecution();
  const playbook = useCurrentPlaybook();
  const selectedStepId = useSelectedStep();
  const history = useExecutionHistory();
  const isStopping = useIsStopping();
  const isExecuting = useIsExecuting(execution?.playbookId);
  const selectStep = usePlaybookStore((s) => s.selectStep);
  const stopExecution = usePlaybookStore((s) => s.stopExecution);
  const deleteAllExecutions = usePlaybookStore((s) => s.deleteAllExecutions);
  const deleteExecution = usePlaybookStore((s) => s.deleteExecution);
  const viewExecutionInPanel = usePlaybookStore((s) => s.viewExecutionInPanel);
  const validateTaskReplay = usePlaybookStore((s) => s.validateTaskReplay);
  const rerunStepInExecution = usePlaybookStore((s) => s.rerunStepInExecution);
  const grabOutputFormatTemplate = usePlaybookStore((s) => s.grabOutputFormatTemplate);
  const fetchExecution = usePlaybookStore((s) => s.fetchExecution);
  const fetchTaskReplays = usePlaybookStore((s) => s.fetchTaskReplays);
  const updateTasks = usePlaybookStore((s) => s.updateTasks);
  const [baselineExecutionId, setBaselineExecutionId] = useState<string | null>(null);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [deleteExecutionDialogOpen, setDeleteExecutionDialogOpen] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState('results');
  const sidebarDragActive = useRef(false);
  const sidebarDragStartX = useRef(0);
  const sidebarDragStartWidth = useRef(0);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidthFallback);

  useEffect(() => {
    const clampWidth = () => {
      if (typeof window === 'undefined') return;
      const maxWidth = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
      setSidebarWidth((current) => Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, current)));
    };

    clampWidth();
    window.addEventListener('resize', clampWidth);
    return () => window.removeEventListener('resize', clampWidth);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(EXECUTION_PANEL_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // Ignore persistence failures in restricted environments.
    }
  }, [sidebarWidth]);

  const onSidebarResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    sidebarDragActive.current = true;
    sidebarDragStartX.current = event.clientX;
    sidebarDragStartWidth.current = sidebarWidth;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [sidebarWidth]);

  const onSidebarResizeMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sidebarDragActive.current || typeof window === 'undefined') return;
    const delta = sidebarDragStartX.current - event.clientX;
    const maxWidth = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    const nextWidth = Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, sidebarDragStartWidth.current + delta));
    setSidebarWidth(nextWidth);
  }, []);

  const onSidebarResizeEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sidebarDragActive.current) return;
    sidebarDragActive.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  // Auto-load the latest execution when panel opens with no execution loaded
  // Guard: only if history belongs to the current playbook
  useEffect(() => {
    if (!execution && history.length > 0 && playbook && history[0].playbookId === playbook.id) {
      viewExecutionInPanel(history[0].id);
    }
  }, [execution, history, playbook, viewExecutionInPanel]);

  // Auto-follow running/interrupted steps during a live execution
  useEffect(() => {
    if (!execution) return;
    const isLive = execution.status === 'running' || execution.status === 'interrupted';
    if (!isLive) return;
    if (selectedStepId && execution.taskResults.some((tr) => tr.taskId === selectedStepId)) return;

    const sorted = [...execution.taskResults].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Interrupted steps take priority
    const interrupted = sorted.find((tr) => tr.status === 'interrupted');
    if (interrupted) {
      selectStep(interrupted.taskId);
      return;
    }

    // Then follow the first running step
    const running = sorted.find((tr) => tr.status === 'running');
    if (running) {
      selectStep(running.taskId);
    }
  }, [execution?.status, execution?.taskResults, selectedStepId, selectStep]);

  const handleSelectStep = useCallback(
    (taskId: string) => {
      selectStep(taskId);
    },
    [selectStep],
  );

  const handleValidateStep = useCallback(
    async (taskId: string, options?: { preserveOutputFormat?: boolean }) => {
      if (!execution) return;

      let taskResult = execution.taskResults.find((tr) => tr.taskId === taskId) || null;
      if (!taskResult?.toolTrace || taskResult.toolTrace.length === 0) {
        await fetchExecution(execution.playbookId, execution.id);
        const refreshedExecution = usePlaybookStore.getState().executionCache[execution.id]
          || usePlaybookStore.getState().currentExecution;
        taskResult = refreshedExecution?.taskResults.find((tr) => tr.taskId === taskId) || null;
      }

      if (!taskResult?.toolTrace || taskResult.toolTrace.length === 0) {
        toast.error('This step has no replayable tool trace yet.');
        return;
      }

      await validateTaskReplay(execution.playbookId, taskId, execution.id, {
        preserveOutputFormat: options?.preserveOutputFormat || false,
      });
      await fetchExecution(execution.playbookId, execution.id);
    },
    [execution, fetchExecution, validateTaskReplay],
  );

  const handleGrabOutputFormat = useCallback(
    async (taskId: string) => {
      if (!execution) return;

      let taskResult = execution.taskResults.find((tr) => tr.taskId === taskId) || null;
      if (!taskResult?.output) {
        await fetchExecution(execution.playbookId, execution.id);
        const refreshedExecution = usePlaybookStore.getState().executionCache[execution.id]
          || usePlaybookStore.getState().currentExecution;
        taskResult = refreshedExecution?.taskResults.find((tr) => tr.taskId === taskId) || null;
      }

      if (!taskResult?.output) {
        toast.error('This step has no output to capture as a format template.');
        return;
      }

      await grabOutputFormatTemplate(execution.playbookId, taskId, {
        executionId: execution.id,
      });
      await fetchExecution(execution.playbookId, execution.id);
    },
    [execution, fetchExecution, grabOutputFormatTemplate],
  );

  const handleRunEvaluation = useCallback(
    async (taskId: string) => {
      if (!execution || !playbook) return;
      setActiveDetailTab('evaluation');
      const task = playbook.tasks.find((candidate) => candidate.id === taskId);
      await rerunStepInExecution(
        execution.playbookId,
        execution.id,
        taskId,
        true,
        task?.stepReplayMode || 'live',
      );
    },
    [execution, playbook, rerunStepInExecution],
  );

  const canStop = execution && (execution.status === 'running' || execution.status === 'interrupted');
  const canDeleteCurrentExecution = Boolean(execution && execution.status !== 'running' && execution.status !== 'interrupted');

  const selectedResult = execution?.taskResults.find(
    (tr) => tr.taskId === selectedStepId,
  ) || null;
  const selectedTask = playbook?.tasks.find((task) => task.id === selectedResult?.taskId) || null;
  const selectedResultRenderKey = [
    execution?.id || 'no-exec',
    selectedResult?.taskId || 'no-step',
    selectedResult?.status || 'no-status',
    selectedResult?.completedAt || 'no-completed-at',
    selectedResult?.output || '',
    selectedResult?.error || '',
    selectedResult?.components?.length || 0,
    selectedResult?.toolTrace?.length || 0,
    selectedResult?.llmPromptTrace?.length || 0,
    selectedResult?.semanticMatch?.matchScore ?? 'no-semantic-match',
  ].join('|');

  useEffect(() => {
    let cancelled = false;

    async function loadBaselineExecutionId() {
      if (!execution?.playbookId || !selectedResult?.taskId) {
        if (!cancelled) setBaselineExecutionId(null);
        return;
      }

      try {
        const replays = await fetchTaskReplays(execution.playbookId, selectedResult.taskId);
        if (cancelled) return;
        const activeReplay = replays.find((replay) => replay.status === 'active') || null;
        setBaselineExecutionId(activeReplay?.referenceExecutionId || null);
      } catch {
        if (!cancelled) setBaselineExecutionId(null);
      }
    }

    loadBaselineExecutionId();
    return () => {
      cancelled = true;
    };
  }, [
    execution?.playbookId,
    selectedResult?.taskId,
    selectedTask?.activeReplayId,
    selectedTask?.activeReplayVersion,
    fetchTaskReplays,
  ]);

  const compareUrl = playbook ? `/playbooks/${playbook.id}/executions` : null;
  const canDeleteAll = history.some((exec) => exec.status !== 'running' && exec.status !== 'interrupted');

  const handleStepReplayModeChange = useCallback(
    (taskId: string, mode: 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive') => {
      if (!playbook) return;
      const updatedTasks = playbook.tasks.map((task) =>
        task.id === taskId ? { ...task, stepReplayMode: mode } : task,
      );
      updateTasks(updatedTasks);
    },
    [playbook, updateTasks],
  );

  const handleDeleteAllExecutions = useCallback(async () => {
    const targetPlaybookId = execution?.playbookId || playbook?.id;
    if (!targetPlaybookId) return;
    await deleteAllExecutions(targetPlaybookId);
    setDeleteAllDialogOpen(false);
  }, [deleteAllExecutions, execution?.playbookId, playbook?.id]);

  if (!execution) {
    return (
      <div
        className="relative flex h-full shrink-0 flex-col overflow-hidden border-l bg-background"
        style={{
          width: sidebarWidth,
          flex: '0 0 auto',
          transition: sidebarDragActive.current ? 'none' : 'width 180ms ease',
        }}
      >
        <div
          onPointerDown={onSidebarResizeStart}
          onPointerMove={onSidebarResizeMove}
          onPointerUp={onSidebarResizeEnd}
          onPointerCancel={onSidebarResizeEnd}
          className="absolute left-0 top-0 bottom-0 z-20 w-1 cursor-ew-resize transition-colors hover:bg-primary/30 active:bg-primary/50"
          style={{ touchAction: 'none' }}
        />
        <div className="flex items-center justify-between px-4 py-1.5 border-b shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{t('execution.title')}</span>
          </div>
        <PanelHeaderActions
          compareUrl={compareUrl}
          historyPickerLabel={t('execution.workflowExecutions')}
          baselineExecutionId={baselineExecutionId}
          onDeleteCurrentExecution={() => setDeleteExecutionDialogOpen(true)}
          canDeleteCurrentExecution={canDeleteCurrentExecution}
          onDeleteAll={() => setDeleteAllDialogOpen(true)}
          canDeleteAll={canDeleteAll}
          onCollapse={onCollapse}
        />
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {history.length > 0
            ? t('execution.selectRunHint')
            : t('execution.noExecution')}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-l bg-background"
      style={{
        width: sidebarWidth,
        flex: '0 0 auto',
        transition: sidebarDragActive.current ? 'none' : 'width 180ms ease',
      }}
    >
      <div
        onPointerDown={onSidebarResizeStart}
        onPointerMove={onSidebarResizeMove}
        onPointerUp={onSidebarResizeEnd}
        onPointerCancel={onSidebarResizeEnd}
        className="absolute left-0 top-0 bottom-0 z-20 w-1 cursor-ew-resize transition-colors hover:bg-primary/30 active:bg-primary/50"
        style={{ touchAction: 'none' }}
      />
      {/* Compact header */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{t('execution.title')}</span>
          <PlaybookStatusBadge status={execution.status} size="md" />
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {getExecutionModeLabel(execution.executionMode, t)}
          </span>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{formatDuration(execution.durationMs)}</span>
          </div>
          {canStop && (
            <Button
              variant="destructive"
              size="sm"
              className="h-6 text-xs px-2"
              disabled={isStopping}
              onClick={() => stopExecution(execution.playbookId, execution.id)}
            >
              <Square className="h-3 w-3 mr-1" />
              {isStopping ? t('execution.stopping') : t('execution.stop')}
            </Button>
          )}
          {execution.status === 'failed' && execution.error && (
            <div className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[200px]" title={execution.error}>
                {execution.error}
              </span>
            </div>
          )}
        </div>
        <PanelHeaderActions
          compareUrl={`/playbooks/${execution.playbookId}/executions`}
          historyPickerLabel={`#${execution.executionNumber}`}
          currentExecutionId={execution.id}
          baselineExecutionId={baselineExecutionId}
          onDeleteCurrentExecution={() => setDeleteExecutionDialogOpen(true)}
          canDeleteCurrentExecution={canDeleteCurrentExecution}
          onDeleteAll={() => setDeleteAllDialogOpen(true)}
          canDeleteAll={canDeleteAll}
          onCollapse={onCollapse}
        />
      </div>

      {/* Step list + detail */}
      <div className="flex flex-1 min-h-0">
        <ExecutionStepList
          taskResults={execution.taskResults}
          selectedStepId={selectedStepId}
          onSelectStep={handleSelectStep}
          pageMode={pageMode}
        />
        <ExecutionStepDetail
          key={selectedResultRenderKey}
          step={selectedResult}
          execution={execution}
          pageMode={pageMode}
          onRequestValidateReplay={(taskId) => {
            void handleValidateStep(taskId, { preserveOutputFormat: false });
          }}
          onRequestRunEvaluation={handleRunEvaluation}
          onRequestGrabOutputFormat={handleGrabOutputFormat}
          onOpenOutputFormatEditor={onOpenOutputFormatEditor}
          onStepReplayModeChange={handleStepReplayModeChange}
          isRunningEvaluation={isExecuting}
          activeTab={activeDetailTab}
          onActiveTabChange={setActiveDetailTab}
        />
      </div>

      <Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all executions</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            Delete all saved executions for this playbook in one shot. Running or interrupted executions will be kept.
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteAllDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteAllExecutions()}
            >
              Delete All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteExecutionDialogOpen} onOpenChange={setDeleteExecutionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete execution</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            Delete the selected workflow execution from this playbook. This action cannot be undone.
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteExecutionDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (execution) {
                  void deleteExecution(execution.playbookId, execution.id);
                }
                setDeleteExecutionDialogOpen(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
