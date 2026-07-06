import { WorkyEvent } from '../interfaces/worky-event.interface';
import { PgMessageRow, PgPlanRow, PgPlanStepRow } from './worky-electric.contract';

type Frame = Omit<WorkyEvent, 'streamId'>;
const now = (): number => Date.now();

// role: messages.role -> WorkyMessage.role enum (owner|manager|system)
export function mapRole(role: string): 'owner' | 'manager' | 'system' {
  const r = (role || '').toLowerCase();
  if (r === 'assistant' || r === 'manager' || r === 'ai') return 'manager';
  if (r === 'user' || r === 'owner' || r === 'human') return 'owner';
  if (r === 'system') return 'system';
  return 'manager'; // unknown -> manager (consumer logs)
}

// plan_steps.status -> WorkyTask.lane enum. Exported so the consumer can detect unknowns.
export const PLAN_STEP_LANE_MAP: Record<string, string> = {
  pending: 'backlog',
  todo: 'backlog',
  not_started: 'backlog',
  planned: 'backlog',
  ready: 'ready',
  queued: 'ready',
  running: 'running',
  in_progress: 'running',
  active: 'running',
  executing: 'running',
  review: 'review',
  in_review: 'review',
  needs_review: 'review',
  blocked: 'blocked',
  waiting: 'blocked',
  on_hold: 'blocked',
  done: 'done',
  completed: 'done',
  complete: 'done',
  success: 'done',
  succeeded: 'done',
  failed: 'failed',
  error: 'failed',
  failure: 'failed',
  canceled: 'canceled',
  cancelled: 'canceled',
  skipped: 'canceled',
  superseded: 'canceled',
};

export function mapStatusToLane(status: string): string {
  return PLAN_STEP_LANE_MAP[(status || '').toLowerCase()] ?? 'backlog';
}

export function isKnownPlanStepStatus(status: string): boolean {
  return (status || '').toLowerCase() in PLAN_STEP_LANE_MAP;
}

function laneToExecState(lane: string): string {
  switch (lane) {
    case 'running':
      return 'running';
    case 'review':
      return 'review';
    case 'blocked':
      return 'waiting_for_event';
    case 'done':
      return 'done';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    default:
      return 'not_started';
  }
}

export function mapMessage(row: PgMessageRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  const role = mapRole(row.role);
  return {
    set: { streamId, externalId: row.id, role, content: row.content, emittedAt: new Date(row.created_at) },
    event: { type: 'message.appended', emittedAt: now(), payload: { role, content: row.content } },
  };
}

export function mapPlanStep(row: PgPlanStepRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  const lane = mapStatusToLane(row.status);
  const title = (row.description?.trim() || `Step ${row.ordinal}`).slice(0, 200);
  const terminal = lane === 'done' || lane === 'failed' || lane === 'canceled';
  return {
    set: {
      streamId,
      externalId: row.step_id,
      title,
      description: row.description ?? '',
      ordinal: row.ordinal,
      lane,
      executionState: laneToExecState(lane),
    },
    event: {
      type: terminal ? 'task.completed' : 'task.updated',
      emittedAt: now(),
      payload: { externalId: row.step_id, lane },
    },
  };
}

export function mapPlan(row: PgPlanRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  return {
    set: { streamId, title: row.title, status: row.status },
    // Reuse existing 'stream.updated' event so the frontend refetches; no new event type needed here.
    event: { type: 'stream.updated', emittedAt: now(), payload: { plan: { title: row.title, status: row.status } } },
  };
}
