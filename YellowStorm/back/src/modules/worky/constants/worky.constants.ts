/**
 * Worky module defaults and shared enums. Kept here (not in the schema
 * files) so the canonical §3.1/§3.2 value lists are visible from one
 * place and easy to cross-check against the implementation plan.
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

export type WorkyStreamStatus = (typeof WORKY_STREAM_STATUSES)[number];

export const WORKY_CONTROL_STATES = [
  'active',
  'pause_requested',
  'paused',
  'resume_requested',
  'stop_requested',
  'stopped',
] as const;

export type WorkyControlState = (typeof WORKY_CONTROL_STATES)[number];

export const WORKY_TASK_LANES = [
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

export type WorkyTaskLane = (typeof WORKY_TASK_LANES)[number];

export const WORKY_TASK_EXECUTION_STATES = [
  'not_started',
  'scheduled',
  'running',
  'waiting_for_event',
  'review',
  'done',
  'failed',
  'canceled',
  'superseded',
] as const;

export type WorkyTaskExecutionState = (typeof WORKY_TASK_EXECUTION_STATES)[number];

export const WORKY_INTERACTION_TYPES = [
  'clarification',
  'approval',
  'review',
  'missing_input',
  'assignment_disambiguation',
  'budget_decision',
  'deadline_decision',
  'escalation_decision',
  'replan_review',
] as const;

export type WorkyInteractionType = (typeof WORKY_INTERACTION_TYPES)[number];

export const WORKY_INTERACTION_BLOCKING_SCOPES = ['task', 'stream'] as const;
export type WorkyInteractionBlockingScope = (typeof WORKY_INTERACTION_BLOCKING_SCOPES)[number];

export const WORKY_GOVERNANCE_LEVELS = ['off', 'notify', 'approval', 'hard_block'] as const;
export type WorkyGovernanceLevel = (typeof WORKY_GOVERNANCE_LEVELS)[number];

export const WORKY_PLAN_DELTA_ACTIONS = [
  'create_tasks',
  'update_tasks',
  'cancel_tasks',
  'clarification_requests',
] as const;

export const WORKY_PLAN_PHASES = ['planning', 'execution', 'replan'] as const;
export type WorkyPlanPhase = (typeof WORKY_PLAN_PHASES)[number];

/**
 * Slug used to seed the Manager agent type during WorkyModule.onModuleInit.
 * Mirrors the `agent.service.ts:MANAGER_SLUG` convention so the resolver
 * logic in `resolveManager` (Part 2/3) can target it without a rename.
 */
export const WORKY_MANAGER_AGENT_TYPE_SLUG = 'manager';

/**
 * Agent-type slugs for the two agents worky forwards to the orchestrator on
 * every turn. The admin creates exactly one default agent of each type; worky
 * resolves those defaults and sends them as `chatbot.Agent` on RunTask /
 * DeliverMailReply (replacing the old planner/executor model + prompt fields).
 */
export const WORKY_PLANNER_AGENT_TYPE_SLUG = 'worky-planner';
export const WORKY_EXECUTOR_AGENT_TYPE_SLUG = 'worky-executer';

export const WORKY_STREAM_TITLE_MIN = 1;
export const WORKY_STREAM_TITLE_MAX = 200;
