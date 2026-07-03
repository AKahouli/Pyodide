import { WorkyEvent } from '../interfaces/worky-event.interface';
import {
  PgWorkyTaskRow,
  PgWorkyTaskResultRow,
  PgWorkyMessageRow,
  PgWorkyInteractionRow,
} from './worky-electric.contract';

type Frame = Omit<WorkyEvent, 'streamId'>;
const now = (): number => Date.now();

export function mapPgTask(row: PgWorkyTaskRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  const set: Record<string, unknown> = {
    externalId: row.id,
    streamId,
    title: row.title,
    description: row.description ?? '',
    lane: row.lane,
    executionState: row.execution_state,
    priority: row.priority ?? 'medium',
    assigneeType: row.assignee_type ?? 'unassigned',
    actionCategory: row.action_category ?? 'internal_analysis',
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
  const terminal = row.lane === 'done' || row.execution_state === 'done';
  const event: Frame = {
    type: terminal ? 'task.completed' : 'task.updated',
    emittedAt: now(),
    payload: { externalId: row.id },
  };
  return { set, event };
}

export function mapPgTaskResult(
  row: PgWorkyTaskResultRow,
  taskObjectId: string,
): { taskId: string; version: number; set: Record<string, unknown>; event: Frame } {
  return {
    taskId: taskObjectId,
    version: row.version,
    set: { taskId: taskObjectId, version: row.version, status: row.status, summary: row.summary ?? '', payload: row.payload ?? null },
    event: { type: 'task.completed', emittedAt: now(), payload: { taskId: taskObjectId, version: row.version } },
  };
}

export function mapPgMessage(row: PgWorkyMessageRow, _streamId: string): { set: Record<string, unknown>; event: Frame } {
  return {
    set: { externalId: row.id, role: row.role, content: row.content, createdAt: new Date(row.created_at) },
    event: { type: 'message.appended', emittedAt: now(), payload: { role: row.role, content: row.content } },
  };
}

export function mapPgInteraction(row: PgWorkyInteractionRow, _streamId: string): { set: Record<string, unknown>; event: Frame } {
  return {
    set: { externalId: row.id, kind: row.kind, prompt: row.prompt, status: row.status, createdAt: new Date(row.created_at) },
    event: { type: 'interaction.requested', emittedAt: now(), payload: { interactionId: row.id, kind: row.kind } },
  };
}
