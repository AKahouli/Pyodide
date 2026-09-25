
export const HITL_MODES = ['auto', 'manual', 'off'] as const;
export const HITL_SENSITIVITIES = ['minimal', 'balanced', 'strict'] as const;
export const HITL_FEEDBACK_SCOPES = ['step_only', 'downstream_run', 'entire_run', 'future_node_runs', 'future_workflow_runs'] as const;
export const HITL_BLOCKER_KINDS = [
  'missing_required_input',
  'missing_document',
  'ambiguous_instruction',
  'destructive_action',
  'external_send',
  'workspace_write',
  'sensitive_domain',
  'low_confidence',
  'cost_or_runtime_risk',
  'explicit_user_instruction',
  'custom',
] as const;
export const HITL_BLOCKER_ACTIONS = ['clarify', 'approve', 'review', 'stop'] as const;
export const HITL_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;

export type HitlMode = (typeof HITL_MODES)[number];
export type HitlSensitivity = (typeof HITL_SENSITIVITIES)[number];
export type HitlFeedbackScope = (typeof HITL_FEEDBACK_SCOPES)[number];
export type HitlBlockerKind = (typeof HITL_BLOCKER_KINDS)[number];
export type HitlBlockerAction = (typeof HITL_BLOCKER_ACTIONS)[number];
export type HitlRiskLevel = (typeof HITL_RISK_LEVELS)[number];

export const DEFAULT_HITL_POLICY = {
  mode: 'auto',
  sensitivity: 'balanced',
  clarificationEnabled: true,
  approvalEnabled: true,
  reviewEnabled: false,
  propagateFeedbackDefault: true,
  defaultFeedbackScope: 'downstream_run',
} as const;

export class HitlPolicy {
  /** Smart HITL policy controls when a workflow or node should pause instead of guessing. */
  mode!: HitlMode;

  sensitivity!: HitlSensitivity;

  clarificationEnabled!: boolean;

  approvalEnabled!: boolean;

  reviewEnabled!: boolean;

  propagateFeedbackDefault!: boolean;

  defaultFeedbackScope!: HitlFeedbackScope;

  inheritedFromWorkflow?: boolean;

  disabledReason?: string | null;
}

export class HitlBlockerRule {
  /** Business-readable blocker rules are stored with matcher metadata for runtime evaluation. */
  id!: string;

  scope!: 'workflow' | 'node';

  nodeId?: string | null;

  enabled!: boolean;

  kind!: HitlBlockerKind;

  label!: string;

  description!: string;

  action!: HitlBlockerAction;

  riskLevel!: HitlRiskLevel;

  sensitivity!: HitlSensitivity;

  matcherType!: string;

  matcherConfig!: Record<string, unknown>;

  promptTemplate?: string | null;

  appliesToToolNames?: string[];

  appliesToConnectorActions?: string[];

  createdBy!: 'system' | 'user' | 'assistant';

  createdAt!: Date;

  updatedAt!: Date;
}
