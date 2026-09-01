import { WorkyEvent } from '../interfaces/worky-event.interface';
import {
  PgMessageRow,
  PgPlanRow,
  PgPlanStepRow,
  PgMessageComponentRow,
  PgPlanStepComponentRow,
  PgPlanStepArtifactRow,
} from './worky-electric.contract';

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
    set: {
      streamId,
      externalId: row.id,
      turnId: row.turn_id ?? null,
      role,
      content: row.content,
      emittedAt: new Date(row.created_at),
    },
    event: {
      type: 'message.appended',
      emittedAt: now(),
      payload: { id: row.id, turnId: row.turn_id ?? null, role, content: row.content },
    },
  };
}

export function mapPlanStep(row: PgPlanStepRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  const lane = mapStatusToLane(row.status);
  // Card headline: prefer the new `title` column; fall back so it's never blank.
  const title = (
    row.title?.trim() ||
    row.description?.trim() ||
    row.question?.trim() ||
    `Step ${row.ordinal}`
  ).slice(0, 200);
  // Subtitle: for ask steps the prompt lives in `question` (description is empty).
  const subtitle = row.kind === 'ask' ? (row.question ?? '') : (row.description ?? '');
  const terminal = lane === 'done' || lane === 'failed' || lane === 'canceled';
  return {
    set: {
      streamId,
      externalId: row.step_id,
      title,
      description: subtitle,
      ordinal: row.ordinal,
      lane,
      executionState: laneToExecState(lane),
      result: row.result ?? null,
      blockedReason: row.blocked_reason ?? null,
      wave: typeof row.wave === 'number' ? row.wave : null,
      dependsOnStepIds: (row.depends_on ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
      assigneeKey: (row.assignee ?? '').trim() || null,
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

/** Electric jsonb may arrive parsed or as a JSON string — normalize to an object. */
function normalizeJson(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function mapMessageComponent(row: PgMessageComponentRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  const data = normalizeJson(row.data);
  return {
    set: {
      streamId,
      externalId: row.component_id,
      messageExternalId: row.message_id,
      ordinal: typeof row.ordinal === 'number' ? row.ordinal : 0,
      type: row.type,
      data,
    },
    event: {
      type: 'message.component.appended',
      emittedAt: now(),
      payload: { messageExternalId: row.message_id, componentId: row.component_id },
    },
  };
}

export function mapPlanStepComponent(row: PgPlanStepComponentRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  const data = normalizeJson(row.data);
  return {
    set: {
      streamId,
      externalId: row.component_id,
      stepExternalId: row.step_id,
      ordinal: typeof row.ordinal === 'number' ? row.ordinal : 0,
      type: row.type,
      data,
    },
    event: {
      type: 'task.component.appended',
      emittedAt: now(),
      payload: { stepExternalId: row.step_id, componentId: row.component_id },
    },
  };
}

export function mapPlanStepArtifact(row: PgPlanStepArtifactRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  return {
    set: {
      streamId,
      externalId: row.artifact_id,
      stepExternalId: row.step_id,
      filePath: row.file_path,
      filename: row.filename,
      artifactKind: row.artifact_kind ?? null,
      mimeType: row.mime_type ?? null,
      size: typeof row.size === 'number' ? row.size : null,
    },
    event: {
      type: 'task.artifact.appended',
      emittedAt: now(),
      payload: { stepExternalId: row.step_id, artifactId: row.artifact_id },
    },
  };
}
