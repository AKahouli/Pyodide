import type { MessageComponent, WorkyBoardResponse, WorkyMessage, WorkyStreamStatus, WorkyTask } from '../types';
import { normalizeChoiceComponentData } from '@/modules/conversation/utils';
import type {
  WorkyCurrentWorkItem,
  WorkyCurrentWorkStatus,
  WorkyDeliveryPath,
  WorkyDelegationItem,
  WorkyExecutiveViewModel,
  WorkyMissionHealth,
  WorkyPendingApproval,
  WorkyRuntimeAttentionItem,
} from './executiveModel';

function deriveDeliveryPaths(tasks: WorkyTask[], byStepId: Map<string, WorkyTask>): WorkyDeliveryPath[] {
  const referenced = new Set(tasks.filter((task) => task.lane !== 'canceled').flatMap((task) => task.dependsOnStepIds ?? []));
  return tasks.filter((task) => task.lane !== 'canceled' && (!task.externalId || !referenced.has(task.externalId))).map((task) => {
    const path = new Map<string, WorkyTask>();
    const seen = new Set<string>();
    const visit = (current: WorkyTask): void => {
      if (seen.has(current.id)) return;
      seen.add(current.id);
      for (const id of current.dependsOnStepIds ?? []) {
        const prerequisite = byStepId.get(id);
        if (prerequisite) visit(prerequisite);
      }
      path.set(current.id, current);
    };
    visit(task);
    const steps = [...path.values()];
    const readyToStart = (step: WorkyTask): boolean => (step.dependsOnStepIds ?? []).every((id) => byStepId.get(id)?.lane === 'done');
    return {
      task,
      total: steps.length,
      completed: steps.filter((step) => step.lane === 'done').length,
      blocked: steps.filter((step) => step.lane === 'failed' || step.lane === 'blocked').length,
      nextTask: steps.find((step) => step.lane === 'failed' || step.lane === 'blocked')
        ?? steps.find((step) => step.lane === 'running' || step.lane === 'review')
        ?? steps.find((step) => (step.lane === 'ready' || step.lane === 'backlog') && readyToStart(step))
        ?? steps.find((step) => step.lane !== 'done' && step.lane !== 'canceled')
        ?? null,
    };
  }).sort((a, b) => Number(a.task.lane === 'done') - Number(b.task.lane === 'done') || b.blocked - a.blocked || (a.task.ordinal ?? 0) - (b.task.ordinal ?? 0));
}

/** Pending send/mail approval gates from the message stream: `confirm::` choice
 *  cards still `ready` (answered ones are flipped to `submitted`). Latest card
 *  per questionId wins, so a re-driven duplicate collapses to one. */
export function collectPendingApprovals(messages: WorkyMessage[]): WorkyPendingApproval[] {
  const byId = new Map<string, MessageComponent>();
  for (const message of messages) {
    for (const component of message.components ?? []) {
      const data = component.data as { questionId?: unknown; status?: unknown } | undefined;
      const questionId = data?.questionId;
      if (component.type !== 'choice' || typeof questionId !== 'string' || !questionId.startsWith('confirm::')) continue;
      const choice = normalizeChoiceComponentData(component.data);
      if (data?.status === 'ready' && choice) byId.set(questionId, { ...component, data: choice });
      else byId.delete(questionId);
    }
  }
  return [...byId.entries()].map(([questionId, component]) => ({ questionId, component }));
}

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
  if (task.lane === 'blocked') return 'blocked';
  if (task.lane === 'running') return 'running';
  if (task.lane === 'review') return 'review';
  if (task.lane === 'ready' || task.lane === 'backlog') return 'pending';
  return null;
}

function deriveHealth(
  board: WorkyBoardResponse,
  tasks: WorkyTask[],
  runtimeAsks: WorkyRuntimeAttentionItem[],
  pendingApprovalsCount: number,
  fallbackStatus?: WorkyStreamStatus,
): WorkyMissionHealth {
  const sessionStatus = board.session?.status;
  if (sessionStatus === 'canceled') return 'stopped';
  if (sessionStatus === 'completed') return 'completed';
  if (sessionStatus === 'paused') return 'paused';
  if (sessionStatus === 'failed') return 'at_risk';
  if (runtimeAsks.some((ask) => ask.active) || board.pendingClarifications.length > 0 || pendingApprovalsCount > 0) return 'needs_attention';
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
  messages: WorkyMessage[] = [],
): WorkyExecutiveViewModel {
  const tasks = Object.values(board.lanes).flat();
  const taskByStepId = new Map(tasks.filter((task) => task.externalId).map((task) => [task.externalId as string, task]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const downstreamByStepId = new Map<string, WorkyTask[]>();
  for (const task of tasks) for (const id of task.dependsOnStepIds ?? []) {
    downstreamByStepId.set(id, [...(downstreamByStepId.get(id) ?? []), task]);
  }
  const downstreamCount = (task: WorkyTask): number => {
    const seen = new Set<string>();
    const visit = (stepId: string): void => {
      for (const dependent of downstreamByStepId.get(stepId) ?? []) {
        if (seen.has(dependent.id)) continue;
        seen.add(dependent.id);
        if (dependent.externalId) visit(dependent.externalId);
      }
    };
    if (task.externalId) visit(task.externalId);
    return [...seen].filter((id) => taskById.get(id)?.lane !== 'done' && taskById.get(id)?.lane !== 'canceled').length;
  };
  const activeInterruptId = board.session?.activeInterruptId ?? null;
  const pendingApprovals = collectPendingApprovals(messages);
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
      if (!status) return null;
      const prerequisites = [...new Set(task.dependsOnStepIds ?? [])].map((id) => taskByStepId.get(id));
      return {
        task,
        status,
        openPrerequisites: prerequisites.filter((item): item is WorkyTask => Boolean(item && item.lane !== 'done' && item.lane !== 'canceled')),
        canceledPrerequisites: prerequisites.filter((item) => item?.lane === 'canceled').length,
        unavailablePrerequisites: prerequisites.filter((item) => !item).length,
        downstreamCount: downstreamCount(task),
      };
    })
    .filter((item): item is WorkyCurrentWorkItem => item !== null)
    .sort((a, b) => CURRENT_WORK_ORDER[a.status] - CURRENT_WORK_ORDER[b.status] || (a.task.ordinal ?? 0) - (b.task.ordinal ?? 0));

  return {
    plan: board.plan ?? null,
    session: board.session ?? null,
    health: deriveHealth(board, tasks, runtimeAsks, pendingApprovals.length, fallbackStatus),
    runtimeAsks,
    interactions: board.pendingClarifications,
    pendingApprovals,
    currentWork,
    allTasks: tasks,
    completedTasks: tasks.filter((task) => task.lane === 'done').sort((a, b) => Date.parse(b.completedAt ?? b.updatedAt ?? '') - Date.parse(a.completedAt ?? a.updatedAt ?? '')),
    deliveryPaths: deriveDeliveryPaths(tasks, taskByStepId),
    recentTasks: tasks.filter((task) => task.updatedAt || task.completedAt).sort((a, b) => Date.parse(b.updatedAt ?? b.completedAt ?? '') - Date.parse(a.updatedAt ?? a.completedAt ?? '')).slice(0, 8),
    delegations: deriveDelegations(tasks),
    summary: {
      total: tasks.length,
      completed: tasks.filter((task) => task.lane === 'done').length,
      active: tasks.filter((task) => task.lane === 'running' || task.lane === 'review').length,
      blocked: tasks.filter((task) => task.lane === 'blocked' || task.lane === 'failed').length,
      remaining: tasks.filter((task) => task.lane !== 'done' && task.lane !== 'canceled').length,
      waitingExternal: currentWork.filter((item) => item.status === 'waiting_external').length,
      needsInput: runtimeAsks.filter((ask) => ask.active).length + board.pendingClarifications.length + pendingApprovals.length,
    },
  };
}
