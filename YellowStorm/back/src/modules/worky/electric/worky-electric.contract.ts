/**
 * Postgres rows the conversation-v2 manager writes, as synced by Electric SQL.
 *
 * ASSUMED CONTRACT: the table/column names below are not yet confirmed with
 * the conversation-v2 team. They must be reconciled before end-to-end wiring
 * against the real Electric shape; if the columns differ, only this file and
 * `worky-electric.mapper.ts` need to change.
 */
export interface PgWorkyTaskRow {
  id: string; // manager PG row id -> WorkyTask.externalId
  session_id: string; // conversation-v2 session id (shape scope)
  title: string;
  description: string | null;
  lane: string; // must be one of WorkyTask.lane enum values
  execution_state: string; // must be one of WorkyTask.executionState enum values
  priority: string | null;
  assignee_type: string | null;
  action_category: string | null;
  started_at: string | null; // ISO timestamp
  completed_at: string | null;
  updated_at: string;
}

export interface PgWorkyTaskResultRow {
  id: string;
  task_id: string; // manager PG task id -> maps to WorkyTask.externalId
  version: number;
  status: string;
  summary: string | null;
  payload: Record<string, unknown> | null;
}

export interface PgWorkyMessageRow {
  id: string;
  session_id: string;
  role: string; // 'owner' | 'manager'
  content: string;
  created_at: string;
}

export interface PgWorkyInteractionRow {
  id: string;
  session_id: string;
  kind: string; // e.g. 'clarification' | 'approval'
  prompt: string;
  status: string;
  created_at: string;
}
