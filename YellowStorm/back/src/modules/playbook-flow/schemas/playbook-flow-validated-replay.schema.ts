import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  FlowTaskJudgeResult,
  FlowTaskPublicReasoningTraceItem,
  FlowTaskSemanticMatch,
  FlowTaskToolTraceItem,
  FlowTaskUsage,
} from './playbook-flow-task-result.schema';
import type {
  ReplayAcceptedExample,
  ReplayContextVariable,
  ReplayDriftPolicy,
  ReplayReasoningStage,
  ReplaySemanticChecklistItem,
  ReplayToolTraceTemplateItem,
} from '../interfaces/playbook-flow-replay-template.interface';

export type FlowValidatedReplayDocument = HydratedDocument<FlowValidatedReplay>;
export type ReplayMode = 'replay_strict' | 'replay_flex' | 'replay_adaptive';

export enum FlowReplayValidationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export enum FlowReplayValidationMode {
  STRICT = 'replay_strict',
  FLEX = 'replay_flex',
  ADAPTIVE = 'replay_adaptive',
  LEGACY_STRICT = 'strict_replay',
}

export function normalizeReplayMode(value: unknown): ReplayMode {
  if (value === FlowReplayValidationMode.FLEX) return FlowReplayValidationMode.FLEX;
  if (value === FlowReplayValidationMode.ADAPTIVE) return FlowReplayValidationMode.ADAPTIVE;
  return FlowReplayValidationMode.STRICT;
}

export function serializeReplayMode(value: unknown): FlowReplayValidationMode {
  if (value === FlowReplayValidationMode.FLEX) return FlowReplayValidationMode.FLEX;
  if (value === FlowReplayValidationMode.ADAPTIVE) return FlowReplayValidationMode.ADAPTIVE;
  return FlowReplayValidationMode.STRICT;
}

export enum FlowReplayFormatGuideStatus {
  DISABLED = 'disabled',
  PENDING = 'pending',
  READY = 'ready',
  FAILED = 'failed',
}

@Schema({ _id: false })
export class FlowReplayToolCall {
  @Prop({ required: true, type: Number })
  callIndex!: number;

  @Prop({ required: true, type: String })
  toolName!: string;

  @Prop({ required: false, type: Object, default: {} })
  args!: Record<string, unknown>;

  @Prop({ required: false, type: String })
  outputSummary?: string;

  @Prop({ required: false, type: String, enum: ['completed', 'failed', 'skipped'], default: null })
  status?: string | null;

  @Prop({ required: false, type: Number, default: null })
  durationMs?: number | null;

  @Prop({ required: false, type: String, default: null })
  error?: string | null;
}

@Schema({ _id: false })
export class FlowReplayLLMPromptTraceItem {
  @Prop({ required: true, type: String })
  stage!: string;

  @Prop({ required: true, type: String })
  model!: string;

  @Prop({ required: true, type: String })
  prompt!: string;
}

@Schema({ _id: false })
export class FlowReplayStaleness {
  @Prop({ required: false, type: Boolean, default: false })
  isStale!: boolean;

  @Prop({ required: false, type: [String], default: [] })
  reasons!: string[];
}

@Schema({ _id: false })
export class FlowReplaySemanticChecklistItem {
  @Prop({ required: true, type: String })
  key!: string;

  @Prop({ required: true, type: String })
  description!: string;

  @Prop({ required: false, type: [String], default: [] })
  variables!: string[];

  @Prop({ required: true, type: String, enum: ['info', 'warning', 'fail'] })
  severity!: ReplaySemanticChecklistItem['severity'];

  @Prop({ required: true, type: String, enum: ['intent', 'reasoning', 'quality_check', 'output_contract', 'context'] })
  source!: ReplaySemanticChecklistItem['source'];
}

@Schema({ _id: false })
export class FlowReplayConfig {
  @Prop({ required: false, type: Boolean, default: false })
  replayOutputFormat!: boolean;

  @Prop({ required: false, type: Boolean, default: false })
  replayToolTrace!: boolean;

  @Prop({ required: false, type: Boolean, default: true })
  replayReasoningChain!: boolean;
}

export enum FlowReplayOutputContractType {
  FREEFORM = 'freeform',
  MARKDOWN_SECTIONS = 'markdown_sections',
  JSON_SCHEMA = 'json_schema',
}

@Schema({ _id: false })
export class FlowReplayFingerprints {
  @Prop({ required: false, type: String, default: null })
  inputContextHash?: string | null;

  @Prop({ required: false, type: String, default: null })
  flowSnapshotHash?: string | null;

  @Prop({ required: false, type: String, default: null })
  nodeSnapshotHash?: string | null;

  @Prop({ required: false, type: String, default: null })
  agentConfigHash?: string | null;

  @Prop({ required: false, type: String, default: null })
  modelConfigHash?: string | null;

  @Prop({ required: false, type: String, default: null })
  toolConfigHash?: string | null;

  @Prop({ required: false, type: String, default: null })
  outputContractHash?: string | null;
}

@Schema({ _id: false })
export class FlowReplayBehaviorBaseline {
  @Prop({ required: false, type: [String], default: [] })
  decisionInvariants!: string[];

  @Prop({ required: false, type: [String], default: [] })
  qualityChecks!: string[];

  @Prop({ required: false, type: [String], default: [] })
  knownFailureModes!: string[];

  @Prop({ required: false, type: String, default: '' })
  behaviorSummary?: string;
}

@Schema({ _id: false })
export class FlowReplayToolPolicy {
  @Prop({ required: false, type: [String], default: [] })
  requiredTools!: string[];

  @Prop({ required: false, type: [String], default: [] })
  forbiddenTools!: string[];

  @Prop({ required: false, type: [String], default: [] })
  sequencingRules!: string[];

  @Prop({ required: false, type: Boolean, default: false })
  requireSameOrder!: boolean;
}

@Schema({ _id: false })
export class FlowReplayOutputContract {
  @Prop({ required: false, type: String, enum: FlowReplayOutputContractType, default: FlowReplayOutputContractType.FREEFORM })
  type!: FlowReplayOutputContractType;

  @Prop({ required: false, type: [String], default: [] })
  requiredSections!: string[];

  @Prop({ required: false, type: [String], default: [] })
  forbiddenSections!: string[];

  @Prop({ required: false, type: Object, default: null })
  jsonSchema?: Record<string, unknown> | null;

  @Prop({ required: false, type: String, enum: ['required', 'optional', 'forbidden'], default: 'optional' })
  citationPolicy!: 'required' | 'optional' | 'forbidden';
}

@Schema({ _id: false })
export class FlowReplayReasoningStage {
  @Prop({ required: true, type: String })
  stageKey!: string;

  @Prop({ required: true, type: String })
  stageType!: string;

  @Prop({ required: true, type: String })
  label!: string;

  @Prop({ required: false, type: String, default: '' })
  description!: string;

  @Prop({ required: false, type: Number, default: null })
  confidence?: number | null;
}

@Schema({ _id: false })
export class FlowReplayContextVariable {
  @Prop({ required: true, type: String })
  key!: string;

  @Prop({ required: true, type: String })
  label!: string;

  @Prop({ required: true, type: String, enum: ['task', 'input_context', 'tool_args', 'unknown'] })
  source!: 'task' | 'input_context' | 'tool_args' | 'unknown';

  @Prop({ required: true, type: String, enum: ['string', 'number', 'boolean', 'array', 'object', 'unknown'] })
  valueType!: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';

  @Prop({ required: false, type: Boolean, default: false })
  required!: boolean;

  @Prop({ required: false, type: String, default: null })
  exampleValue?: string | null;
}

@Schema({ _id: false })
export class FlowReplayToolTraceTemplateItem {
  @Prop({ required: true, type: Number })
  stepIndex!: number;

  @Prop({ required: true, type: String })
  toolName!: string;

  @Prop({ required: false, type: String, default: '' })
  purpose!: string;

  @Prop({ required: false, type: Object, default: {} })
  argumentShape!: Record<string, unknown>;

  @Prop({ required: false, type: Boolean, default: true })
  required!: boolean;
}

@Schema({ _id: false })
export class FlowReplayDriftPolicy {
  @Prop({ required: false, type: Boolean, default: true })
  requireSameIntent!: boolean;

  @Prop({ required: false, type: Boolean, default: true })
  requireSameReasoningStages!: boolean;

  @Prop({ required: false, type: Boolean, default: true })
  requireSameToolOrder!: boolean;

  @Prop({ required: false, type: Boolean, default: false })
  allowAdditionalTools!: boolean;

  @Prop({ required: false, type: Boolean, default: true })
  allowArgumentValueChanges!: boolean;

  @Prop({ required: false, type: Boolean, default: true })
  enforceOutputContract!: boolean;
}

@Schema({ _id: false })
export class FlowReplayAcceptedExample {
  @Prop({ required: true, type: String })
  referenceExecutionId!: string;

  @Prop({ required: true, type: Number })
  referenceExecutionNumber!: number;

  @Prop({ required: true, type: String })
  summary!: string;

  @Prop({ required: false, type: String, default: null })
  outputPreview?: string | null;
}

@Schema({ timestamps: true, collection: 'playbook_flow_validated_replays' })
export class FlowValidatedReplay {
  @Prop({ required: true, type: String, index: true })
  flowId!: string;

  @Prop({ required: true, type: String, index: true })
  taskId!: string;

  @Prop({ required: true, type: Number })
  iteration!: number;

  @Prop({ required: true, type: String })
  taskTitle!: string;

  @Prop({ required: false, type: String, default: '' })
  referenceTaskDescription?: string;

  @Prop({ required: false, type: String })
  referenceAssignedAgentId?: string;

  @Prop({ required: false, type: [String], default: [] })
  referenceWorkspaceIds!: string[];

  @Prop({ required: false, type: String, default: '' })
  agentName?: string;

  @Prop({ required: true, type: String })
  createdBy!: string;

  @Prop({ required: true, type: String, index: true })
  referenceExecutionId!: string;

  @Prop({ required: true, type: Number })
  referenceExecutionNumber!: number;

  @Prop({ required: true, type: Number })
  validationVersion!: number;

  @Prop({ type: String, enum: FlowReplayValidationStatus, default: FlowReplayValidationStatus.ACTIVE })
  status!: FlowReplayValidationStatus;

  @Prop({ type: String, enum: FlowReplayValidationMode, default: FlowReplayValidationMode.STRICT })
  mode!: FlowReplayValidationMode;

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplayToolCall)], default: [] })
  toolCalls!: FlowReplayToolCall[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowTaskPublicReasoningTraceItem)], default: [] })
  reasoningChain!: FlowTaskPublicReasoningTraceItem[];

  @Prop({ required: false, type: String })
  referenceOutput?: string;

  @Prop({ required: false, type: Boolean, default: false })
  preserveOutputFormat?: boolean;

  @Prop({ required: false, type: String })
  outputFormatGuide?: string;

  @Prop({ type: String, enum: FlowReplayFormatGuideStatus, default: FlowReplayFormatGuideStatus.DISABLED })
  formatGuideStatus!: FlowReplayFormatGuideStatus;

  @Prop({ required: false, type: String })
  formatGuideError?: string;

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplayLLMPromptTraceItem)], default: [] })
  llmPromptTrace!: FlowReplayLLMPromptTraceItem[];

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplayFingerprints), default: null })
  fingerprints?: FlowReplayFingerprints | null;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplayBehaviorBaseline), default: null })
  behaviorBaseline?: FlowReplayBehaviorBaseline | null;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplayToolPolicy), default: null })
  toolPolicy?: FlowReplayToolPolicy | null;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplayOutputContract), default: null })
  outputContract?: FlowReplayOutputContract | null;

  @Prop({ required: false, type: String, default: null })
  intentKey?: string | null;

  @Prop({ required: false, type: String, default: '' })
  intentLabel?: string;

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplayReasoningStage)], default: [] })
  reasoningOutline!: FlowReplayReasoningStage[];

  @Prop({ required: false, type: [String], default: [] })
  stableReasoningRules!: string[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplayContextVariable)], default: [] })
  contextVariableSchema!: FlowReplayContextVariable[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplayToolTraceTemplateItem)], default: [] })
  toolTraceTemplate!: FlowReplayToolTraceTemplateItem[];

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplayDriftPolicy), default: null })
  driftPolicy?: FlowReplayDriftPolicy | null;

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplayAcceptedExample)], default: [] })
  acceptedExamples!: FlowReplayAcceptedExample[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplaySemanticChecklistItem)], default: [] })
  semanticChecklist!: ReplaySemanticChecklistItem[];

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowTaskUsage), default: null })
  referenceUsage?: FlowTaskUsage | null;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowTaskSemanticMatch), default: null })
  referenceSemanticMatch?: FlowTaskSemanticMatch | null;

  @Prop({ required: false, type: Object, default: {} })
  traceMetadata?: Record<string, unknown>;

  @Prop({ required: false, type: Number })
  referenceFlowRevision?: number;

  @Prop({ required: false, type: Object, default: null })
  referenceNodeSnapshot?: Record<string, unknown> | null;

  @Prop({ required: false, type: Boolean, default: false })
  isStale!: boolean;

  @Prop({ required: false, type: [String], default: [] })
  staleReasons!: string[];

  @Prop({ required: false, type: String })
  label?: string;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplayConfig), default: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true } })
  replayConfig!: FlowReplayConfig;
}

export interface ReplayFingerprintInput {
  inputContext?: unknown;
  flowSnapshot?: unknown;
  nodeSnapshot?: Record<string, unknown> | null;
  agentConfig?: Record<string, unknown> | null;
  modelConfig?: Record<string, unknown> | null;
  toolConfig?: Record<string, unknown> | null;
  outputContract?: FlowReplayOutputContract | null;
}

export interface BuildValidatedReplayBaselineInput {
  taskId: string;
  taskTitle?: string | null;
  taskDescription?: string | null;
  referenceExecutionId: string;
  referenceExecutionNumber: number;
  mode?: unknown;
  inputContext?: unknown;
  flowSnapshot?: unknown;
  nodeSnapshot?: Record<string, unknown> | null;
  taskResult: {
    output?: unknown;
    toolTrace?: FlowTaskToolTraceItem[];
    reasoningChain?: FlowTaskPublicReasoningTraceItem[];
    judgeResult?: FlowTaskJudgeResult | null;
  };
  preserveOutputFormat?: boolean;
  outputFormatGuide?: string | null;
}

export interface ValidatedReplayBaselineFields {
  mode: ReplayMode;
  fingerprints: FlowReplayFingerprints;
  behaviorBaseline: FlowReplayBehaviorBaseline;
  toolPolicy: FlowReplayToolPolicy;
  outputContract: FlowReplayOutputContract | null;
  intentKey: string | null;
  intentLabel: string;
  reasoningOutline: ReplayReasoningStage[];
  stableReasoningRules: string[];
  contextVariableSchema: ReplayContextVariable[];
  toolTraceTemplate: ReplayToolTraceTemplateItem[];
  driftPolicy: ReplayDriftPolicy;
  acceptedExamples: ReplayAcceptedExample[];
  semanticChecklist: ReplaySemanticChecklistItem[];
}

export const FlowValidatedReplaySchema = SchemaFactory.createForClass(FlowValidatedReplay);

FlowValidatedReplaySchema.index(
  { flowId: 1, taskId: 1, iteration: 1, validationVersion: -1 },
  { unique: true },
);
FlowValidatedReplaySchema.index({ flowId: 1, taskId: 1, status: 1 });

FlowValidatedReplaySchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    ret.mode = serializeReplayMode(ret.mode);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
