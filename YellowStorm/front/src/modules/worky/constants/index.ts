/**
 * Worky module constants. Kept colocated with the module to avoid
 * pulling in domain enums from the backend. Mirrors canonical §3.1 +
 * §3.2 status / control-state value lists.
 */

export const WORKY_STREAM_STATUSES = [
  'created',
  'planning',
  'start_requested',
  'start_validation_failed',
  'active',
  'partially_blocked',
  'waiting_for_owner',
  'waiting_for_human',
  'waiting_for_budget_decision',
  'paused',
  'stopped',
  'completed',
  'archived',
] as const;

export const WORKY_CONTROL_STATES = [
  'active',
  'pause_requested',
  'paused',
  'resume_requested',
  'stop_requested',
  'stopped',
] as const;

export const WORKY_LANES = [
  'backlog',
  'ready',
  'running',
  'review',
  'blocked',
  'done',
  'failed',
  'canceled',
  'superseded',
  'archived',
] as const;

export const WORKY_STREAM_TITLE_MIN = 1;
export const WORKY_STREAM_TITLE_MAX = 200;
