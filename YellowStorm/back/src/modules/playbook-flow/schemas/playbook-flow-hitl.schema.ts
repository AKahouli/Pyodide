import { Prop, Schema } from '@nestjs/mongoose';

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

@Schema({ _id: false })
export class HitlPolicy {
  /** Smart HITL policy controls when a workflow or node should pause instead of guessing. */
  @Prop({ required: true, type: String, enum: HITL_MODES, default: DEFAULT_HITL_POLICY.mode })
  mode!: HitlMode;

  @Prop({ required: true, type: String, enum: HITL_SENSITIVITIES, default: DEFAULT_HITL_POLICY.sensitivity })
  sensitivity!: HitlSensitivity;

  @Prop({ required: true, type: Boolean, default: DEFAULT_HITL_POLICY.clarificationEnabled })
  clarificationEnabled!: boolean;

  @Prop({ required: true, type: Boolean, default: DEFAULT_HITL_POLICY.approvalEnabled })
  approvalEnabled!: boolean;

  @Prop({ required: true, type: Boolean, default: DEFAULT_HITL_POLICY.reviewEnabled })
  reviewEnabled!: boolean;

  @Prop({ required: true, type: Boolean, default: DEFAULT_HITL_POLICY.propagateFeedbackDefault })
  propagateFeedbackDefault!: boolean;

  @Prop({ required: true, type: String, enum: HITL_FEEDBACK_SCOPES, default: DEFAULT_HITL_POLICY.defaultFeedbackScope })
  defaultFeedbackScope!: HitlFeedbackScope;

  @Prop({ required: false, type: Boolean })
  inheritedFromWorkflow?: boolean;

  @Prop({ required: false, type: String, default: null })
  disabledReason?: string | null;
}

@Schema({ _id: false })
export class HitlBlockerRule {
  /** Business-readable blocker rules are stored with matcher metadata for runtime evaluation. */
  @Prop({ required: true, type: String })
  id!: string;

  @Prop({ required: true, type: String, enum: ['workflow', 'node'], default: 'workflow' })
  scope!: 'workflow' | 'node';

  @Prop({ required: false, type: String, default: null })
  nodeId?: string | null;

  @Prop({ required: true, type: Boolean, default: true })
  enabled!: boolean;

  @Prop({ required: true, type: String, enum: HITL_BLOCKER_KINDS })
  kind!: HitlBlockerKind;

  @Prop({ required: true, type: String })
  label!: string;

  @Prop({ required: true, type: String })
  description!: string;

  @Prop({ required: true, type: String, enum: HITL_BLOCKER_ACTIONS })
  action!: HitlBlockerAction;

  @Prop({ required: true, type: String, enum: HITL_RISK_LEVELS, default: 'medium' })
  riskLevel!: HitlRiskLevel;

  @Prop({ required: true, type: String, enum: HITL_SENSITIVITIES, default: 'balanced' })
  sensitivity!: HitlSensitivity;

  @Prop({ required: true, type: String, enum: ['deterministic', 'tool_action', 'input_binding', 'llm_judge', 'custom_expression'] })
  matcherType!: string;

  @Prop({ required: true, type: Object, default: () => ({}) })
  matcherConfig!: Record<string, unknown>;

  @Prop({ required: false, type: String, default: null })
  promptTemplate?: string | null;

  @Prop({ required: false, type: [String], default: [] })
  appliesToToolNames?: string[];

  @Prop({ required: false, type: [String], default: [] })
  appliesToConnectorActions?: string[];

  @Prop({ required: true, type: String, enum: ['system', 'user', 'assistant'], default: 'system' })
  createdBy!: 'system' | 'user' | 'assistant';

  @Prop({ required: true, type: Date, default: Date.now })
  createdAt!: Date;

  @Prop({ required: true, type: Date, default: Date.now })
  updatedAt!: Date;
}
