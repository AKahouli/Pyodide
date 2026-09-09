import type { WorkyBoardResponse, WorkyStreamStatus, WorkyTask } from '../types';
import type {
  WorkyCurrentWorkItem,
  WorkyCurrentWorkStatus,
  WorkyDelegationItem,
  WorkyExecutiveViewModel,
  WorkyMissionHealth,
  WorkyRuntimeAttentionItem,
} from './executiveModel';

const CURRENT_WORK_ORDER: Record<WorkyCurrentWorkStatus, number> = {
  needs_input: 0,
  failed: 1,
  blocked: 2,
  running: 3,
  review: 4,
  pending: 5,
  waiting_external: 6,
};

function currentWorkStatus(task: WorkyTask, activeInterruptId: string | null): WorkyCurrentWorkStatus | null {
  const kind = task.kind ?? 'execute';
  if (kind === 'ask' && task.lane === 'blocked' && task.interruptId === activeInterruptId) return 'needs_input';
  if (task.lane === 'failed') return 'failed';
  if (kind === 'await_reply' && task.lane === 'blocked') return 'waiting_external';
  if (task.lane === 'blocked' && kind === 'execute') return 'blocked';
  if (task.lane === 'running') return 'running';
  if (task.lane === 'review') return 'review';
  if (task.lane === 'ready' || task.lane === 'backlog') return 'pending';
  return null;
}

function deriveHealth(
  board: WorkyBoardResponse,
  tasks: WorkyTask[],
  runtimeAsks: WorkyRuntimeAttentionItem[],
  fallbackStatus?: WorkyStreamStatus,
): WorkyMissionHealth {
  const sessionStatus = board.session?.status;
  if (sessionStatus === 'canceled') return 'stopped';
  if (sessionStatus === 'completed') return 'completed';
  if (sessionStatus === 'paused') return 'paused';
  if (sessionStatus === 'failed') return 'at_risk';
  if (runtimeAsks.some((ask) => ask.active) || board.pendingClarifications.length > 0) return 'needs_attention';
  if (board.plan?.status === 'failed' || tasks.some((task) => task.lane === 'failed')) return 'at_risk';
  if (tasks.some((task) => (task.kind ?? 'execute') === 'execute' && task.lane === 'blocked')) return 'at_risk';
  if (board.plan?.status === 'completed') return 'completed';
  if (board.plan?.status === 'canceled') return 'stopped';
  if (!board.plan || board.plan.status === 'pending') {
    if (!board.session && fallbackStatus === 'completed') return 'completed';
    if (!board.session && fallbackStatus === 'stopped') return 'stopped';
    if (!board.session && fallbackStatus === 'paused') return 'paused';
    return 'planning';
  }
  return 'on_track';
}

function deriveDelegations(tasks: WorkyTask[]): WorkyDelegationItem[] {
  const groups = new Map<string, WorkyDelegationItem>();
  for (const task of tasks) {
    const key = task.assigneeKey?.trim();
    if (!key) continue;
    const existing = groups.get(key);
    const active = task.lane === 'running' || task.lane === 'review';
    if (existing) {
      existing.taskCount += 1;
      if (active) existing.activeCount += 1;
      continue;
    }
    groups.set(key, {
      key,
      name: task.assigneeName?.trim() || key,
      role: task.assigneeRole?.trim() || null,
      type: task.isPersona === true ? 'human' : 'ai',
      taskCount: 1,
      activeCount: active ? 1 : 0,
    });
  }
  return [...groups.values()].sort((a, b) => b.activeCount - a.activeCount || a.name.localeCompare(b.name));
}

export function deriveExecutiveView(
  board: WorkyBoardResponse,
  fallbackStatus?: WorkyStreamStatus,
): WorkyExecutiveViewModel {
  const tasks = Object.values(board.lanes).flat();
  const activeInterruptId = board.session?.activeInterruptId ?? null;
  const runtimeAsks = tasks
    .filter((task) => task.kind === 'ask' && task.lane === 'blocked' && task.interruptId)
    .map((task) => ({
      taskId: task.id,
      interruptId: task.interruptId as string,
      question: task.question?.trim() || task.description || task.title,
      active: board.session?.status === 'waiting' && task.interruptId === activeInterruptId,
    }));
  const currentWork: WorkyCurrentWorkItem[] = tasks
    .map((task) => {
      const status = currentWorkStatus(task, activeInterruptId);
      return status ? { task, status } : null;
    })
    .filter((item): item is WorkyCurrentWorkItem => item !== null)
    .sort((a, b) => CURRENT_WORK_ORDER[a.status] - CURRENT_WORK_ORDER[b.status] || (a.task.ordinal ?? 0) - (b.task.ordinal ?? 0));

  return {
    plan: board.plan ?? null,
    session: board.session ?? null,
    health: deriveHealth(board, tasks, runtimeAsks, fallbackStatus),
    runtimeAsks,
    interactions: board.pendingClarifications,
    currentWork,
    delegations: deriveDelegations(tasks),
    summary: {
      total: tasks.length,
      completed: tasks.filter((task) => task.lane === 'done').length,
      active: tasks.filter((task) => task.lane === 'running' || task.lane === 'review').length,
      waitingExternal: currentWork.filter((item) => item.status === 'waiting_external').length,
      needsInput: runtimeAsks.filter((ask) => ask.active).length + board.pendingClarifications.length,
    },
  };
}
