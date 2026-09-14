/** Rows the manager writes, synced by Electric. Reconciled to the real contract. */

/** Session lifecycle row (sessions shape). PK is `id` (the ai session id, which
 *  joins WorkyStream.aiSessionId). The UI treats completed|failed|canceled|
 *  stopped as terminal — the turn is over — and clears the "working" state. */
export interface PgSessionRow {
  id: string;
  user_id: string;
  status: string;
  interrupt_id?: string | null;
}

export interface PgMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  turn_id?: string | null;
  created_at: string;
}

export interface PgPlanRow {
  session_id: string;
  title: string;
  goal?: string | null;
  status: string;
}

export interface PgSessionRow {
  id: string;
  status: string;
  interrupt_id?: string | null;
}

export interface PgPlanStepRow {
  session_id: string;
  step_id: string;
  ordinal: number;
  status: string;
  title?: string; // card headline (short label); falls back to description/question
  description: string;
  result?: string | null;
  blocked_reason?: string | null;
  kind?: string;
  question?: string;
  depends_on?: string; // comma-joined step_ids
  wave?: number;
  assignee?: string; // which executor sub-agent is handling this step (for display/grouping)
  interrupt_id?: string | null;
  assignee_name?: string | null;
  assignee_role?: string | null;
  is_persona?: boolean;
  is_dynamic_delegate?: boolean;
}

/** One fully-formed component of a manager chat message (message_components shape). */
export interface PgMessageComponentRow {
  session_id: string;
  message_id: string; // joins messages(id)
  component_id: string;
  ordinal: number;
  type: string; // ComponentType: text|code|chart|artifact|citation|toolActivity|...
  data: unknown; // JSONB — object, or a JSON string (Electric variance)
  created_at: string;
}

/** One fully-formed component of a step result (plan_step_components shape). */
export interface PgPlanStepComponentRow {
  session_id: string;
  step_id: string; // joins plan_steps(session_id, step_id)
  component_id: string;
  ordinal: number;
  type: string;
  data: unknown;
  created_at: string;
}

/** A step file deliverable (plan_step_artifacts shape). */
export interface PgPlanStepArtifactRow {
  session_id: string;
  step_id: string;
  artifact_id: string;
  file_path: string; // storage key, stored raw
  filename: string;
  artifact_kind?: string | null; // image | data | code | document | null
  mime_type?: string | null;
  size?: number | null;
  created_at: string;
}
