import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  FlowTaskPublicReasoningTraceItem,
  FlowTaskSemanticMatch,
  FlowTaskUsage,
} from './playbook-flow-task-result.schema';

export type FlowValidatedReplayDocument = HydratedDocument<FlowValidatedReplay>;

export enum FlowReplayValidationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export enum FlowReplayValidationMode {
  STRICT_REPLAY = 'strict_replay',
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
export class FlowReplayConfig {
  @Prop({ required: false, type: Boolean, default: false })
  replayOutputFormat!: boolean;

  @Prop({ required: false, type: Boolean, default: false })
  replayToolTrace!: boolean;

  @Prop({ required: false, type: Boolean, default: false })
  replayReasoningChain!: boolean;
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

  @Prop({ type: String, enum: FlowReplayValidationMode, default: FlowReplayValidationMode.STRICT_REPLAY })
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

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplayConfig), default: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false } })
  replayConfig!: FlowReplayConfig;
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
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
