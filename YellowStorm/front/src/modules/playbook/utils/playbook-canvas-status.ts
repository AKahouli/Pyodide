import { TRIGGER_NODE_ID } from '../hooks/helpers/node-serializer';
import type { Playbook, PlaybookExecution, PlaybookTask, StepStatus } from '../types';

const STEP_STATUS_PRIORITY: Record<StepStatus, number> = {
  running: 5,
  interrupted: 4,
  pending_approval: 4,
  cancelled: 3,
  failed: 3,
  completed: 2,
  skipped: 1,
  pending: 0,
  queued: 0,
};

const CANVAS_JUDGE_STATUS_PRIORITY = {
  idle: 0,
  evaluating: 1,
  evaluated: 2,
  failed: 2,
} as const;

export type CanvasJudgeState = {
  judgeStatus: NonNullable<PlaybookExecution['taskResults'][number]['judgeStatus']>;
  judgeResult: PlaybookExecution['taskResults'][number]['judgeResult'];
  iteration: number;
};

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

export function canReuseExecutionForTask(
  execution: { playbookSnapshot?: unknown } | null,
  task: Partial<PlaybookTask> | null | undefined,
): boolean {
  if (!execution || !task?.id) return false;
  const snapshotTasks = ((execution.playbookSnapshot as { tasks?: Partial<PlaybookTask>[] } | null)?.tasks) || [];
  const snapshotTask = snapshotTasks.find((candidate) => candidate.id === task.id);
  if (!snapshotTask) return true;
  return JSON.stringify(normalizeTaskForExecutionReuse(snapshotTask)) === JSON.stringify(normalizeTaskForExecutionReuse(task));
}

export function getVisibleExecutionStatus(execution?: PlaybookExecution | null): PlaybookExecution['status'] | null {
  if (!execution) return null;
  if (execution.taskResults.some((taskResult) => taskResult.status === 'running')) return 'running';
  if (execution.taskResults.some((taskResult) => taskResult.status === 'interrupted')) return 'interrupted';
  return execution.status;
}

const ACTIVE_EXECUTION_STATUSES: ReadonlySet<NonNullable<PlaybookExecution['status']>> = new Set([
  'queued',
  'running',
  'interrupted',
  'pending_approval',
]);

export function isActiveExecutionStatus(status: PlaybookExecution['status'] | null | undefined): boolean {
  return Boolean(status && ACTIVE_EXECUTION_STATUSES.has(status));
}

/**
 * Fallback polling cadence per execution state. Running/queued executions are
 * short-lived and poll fast; waiting states (interrupted, pending approval)
 * can last hours, so they poll slowly to avoid sustained request load.
 */
export function getExecutionPollIntervalMs(status: PlaybookExecution['status'] | null | undefined): number {
  switch (status) {
    case 'running':
      return 2000;
    case 'queued':
      return 5000;
    case 'interrupted':
      return 15000;
    case 'pending_approval':
      return 15000;
    default:
      return 2000;
  }
}

export function hasPendingJudgeEvaluations(execution?: PlaybookExecution | null): boolean {
  if (!execution) return false;
  return execution.taskResults.some((taskResult) => taskResult.judgeStatus === 'evaluating');
}

export function getSnapshotTask(execution?: PlaybookExecution | null, taskId?: string | null): PlaybookTask | null {
  if (!execution || !taskId) return null;
  const snapshotTasks = ((execution.playbookSnapshot as { tasks?: PlaybookTask[] } | null)?.tasks) || [];
  return snapshotTasks.find((task) => task.id === taskId) || null;
}

function isIteratorChildTask(task: Pick<PlaybookTask, 'containerConfig'> | null | undefined): boolean {
  return Boolean(task?.containerConfig?.parentIteratorId);
}

export function canExecuteSingleStep(
  playbook: Pick<Playbook, 'edges' | 'dataBindings' | 'tasks'> | null | undefined,
  task: PlaybookTask | null | undefined,
): boolean {
  if (!task) return false;

  const nodeType = task.nodeType;
  const isStandaloneStep = !nodeType || nodeType === 'agent' || nodeType === 'action' || nodeType === 'evaluation';
  if (!isStandaloneStep || task.containerConfig?.parentIteratorId) {
    return false;
  }

  const incomingEdges = (playbook?.edges ?? []).filter((edge) => edge.targetId === task.id);
  const tasks = playbook?.tasks ?? [];
  const hasUnsupportedIncomingEdge = incomingEdges.some((edge) => {
    if (edge.sourceId === TRIGGER_NODE_ID) return false;
    const sourceTask = tasks.find((t) => t.id === edge.sourceId);
    if (!sourceTask) return true;
    const sourceKind = sourceTask.nodeType || 'agent';
    return !['agent', 'action', 'evaluation'].includes(sourceKind);
  });
  return !hasUnsupportedIncomingEdge;
}

function getJudgeResultCompletenessScore(
  judgeResult: PlaybookExecution['taskResults'][number]['judgeResult'],
): number {
  if (!judgeResult) {
    return 0;
  }

  return Object.values(judgeResult).reduce((score: number, value) => {
    return score + (value === null || value === undefined ? 0 : 1);
  }, 0);
}

function shouldReplaceCanvasJudgeState(current: CanvasJudgeState | undefined, incoming: CanvasJudgeState): boolean {
  if (!current) {
    return true;
  }

  const currentPriority = CANVAS_JUDGE_STATUS_PRIORITY[current.judgeStatus] ?? 0;
  const incomingPriority = CANVAS_JUDGE_STATUS_PRIORITY[incoming.judgeStatus] ?? 0;
  if (incomingPriority !== currentPriority) {
    return incomingPriority > currentPriority;
  }

  if (incoming.judgeStatus !== current.judgeStatus) {
    return incoming.iteration >= current.iteration;
  }

  const incomingResultCompleteness = getJudgeResultCompletenessScore(incoming.judgeResult);
  const currentResultCompleteness = getJudgeResultCompletenessScore(current.judgeResult);
  if (incomingResultCompleteness !== currentResultCompleteness) {
    return incomingResultCompleteness > currentResultCompleteness;
  }

  if (incoming.judgeResult && !current.judgeResult) {
    return true;
  }

  if (current.judgeResult && !incoming.judgeResult) {
    return false;
  }

  return incoming.iteration >= current.iteration;
}

export function buildCanvasJudgeStateMap(
  taskResults: PlaybookExecution['taskResults'] | null | undefined,
): Map<string, CanvasJudgeState> {
  const map = new Map<string, CanvasJudgeState>();
  if (!taskResults) return map;

  for (const tr of taskResults) {
    const incomingState: CanvasJudgeState = {
      judgeStatus: tr.judgeStatus || 'idle',
      judgeResult: tr.judgeResult || null,
      iteration: tr.iteration ?? 0,
    };
    if (shouldReplaceCanvasJudgeState(map.get(tr.taskId), incomingState)) {
      map.set(tr.taskId, incomingState);
    }
  }

  return map;
}

export function buildCanvasStepStatusMap(
  taskResults: PlaybookExecution['taskResults'] | null | undefined,
  tasks: ReadonlyArray<Pick<PlaybookTask, 'id' | 'containerConfig'>>,
): Map<string, StepStatus> {
  const map = new Map<string, StepStatus>();
  if (!taskResults) return map;

  const iteratorChildTaskIds = new Set(
    tasks
      .filter(isIteratorChildTask)
      .map((task) => task.id),
  );

  for (const tr of taskResults) {
    for (const iteration of tr.iteratorIterations || []) {
      for (const childResult of iteration.childResults || []) {
        const currentStatus = map.get(childResult.taskId);
        if (!currentStatus || STEP_STATUS_PRIORITY[childResult.status] > STEP_STATUS_PRIORITY[currentStatus]) {
          map.set(childResult.taskId, childResult.status);
        }
      }
    }
  }

  for (const tr of taskResults) {
    if (iteratorChildTaskIds.has(tr.taskId) && map.has(tr.taskId)) {
      continue;
    }
    const currentStatus = map.get(tr.taskId);
    if (!currentStatus || STEP_STATUS_PRIORITY[tr.status] > STEP_STATUS_PRIORITY[currentStatus]) {
      map.set(tr.taskId, tr.status);
    }
  }

  return map;
}
