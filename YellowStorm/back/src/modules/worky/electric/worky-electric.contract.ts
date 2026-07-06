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
  description: string;
}
