/** Rows the manager writes, synced by Electric. Reconciled to the real contract. */
export interface PgMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface PgPlanRow {
  session_id: string;
  title: string;
  status: string;
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
}

/** One fully-formed component of a manager chat message (message_components shape). */
export interface PgMessageComponentRow {
  session_id: string;
  message_id: string; // joins messages(id)
  component_id: string;
  ordinal: number;
  type: string; // ComponentType: text|code|chart|artifact|citation|toolInfo|...
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
