import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ADVISOR_SCORING_MODES, AdvisorScoringMode } from './playbook-flow.schema';

@Schema({ _id: false })
export class ReplayPlanningMetadata {
  @Prop({ required: true, type: String })
  replayId!: string;

  @Prop({ required: true, type: Number })
  validationVersion!: number;

  @Prop({ required: false, type: String, default: null })
  intentKey?: string | null;

  @Prop({ required: false, type: String, default: null })
  intentLabel?: string | null;

  @Prop({ required: false, type: [Object], default: [] })
  contextMapping!: Array<Record<string, unknown>>;

  @Prop({ required: false, type: Object, default: null })
  executionPlan?: Record<string, unknown> | null;
}

export type FlowExecutionDocument = HydratedDocument<FlowExecution>;

@Schema({ _id: false })
export class SeededTaskOutput {
  @Prop({ required: true, type: String })
  nodeId!: string;

  @Prop({ required: true, type: Number, default: 0 })
  iteration!: number;

  @Prop({ required: true, type: Object })
  payload!: Record<string, unknown>;
}

@Schema({ _id: false })
export class PendingApproval {
  @Prop({ required: true, type: String })
  nodeId!: string;

  @Prop({ required: true, type: Number, default: 0 })
  iteration!: number;

  @Prop({ required: true, type: String })
  prompt!: string;

  @Prop({ required: false, type: Date })
  requestedAt?: Date;
}

@Schema({ timestamps: true })
export class FlowExecution {
  @Prop({ required: true, type: String })
  flowId!: string;

  @Prop({ required: true, type: String })
  ownerId!: string;

  @Prop({ required: true, type: Number, default: 1 })
  schemaVersion!: number;

  @Prop({ required: true, type: String, enum: ['queued', 'running', 'pending_approval', 'completed', 'failed', 'cancelled'], default: 'queued' })
  status!: string;

  @Prop({ required: false, type: Date })
  startedAt?: Date;

  @Prop({ required: false, type: Date })
  endedAt?: Date;

  @Prop({ required: false, type: String })
  error?: string;

  @Prop({ required: true, type: Number, default: 25 })
  recursionLimit!: number;

  @Prop({ required: true, type: Number, default: 5 })
  maxParallelism!: number;

  @Prop({ required: false, type: Object })
  inputContext?: Record<string, unknown>;

  @Prop({ required: false, type: Object, select: false })
  snapshot?: Record<string, unknown>;

  @Prop({ required: false, type: String })
  idempotencyKey?: string;

  @Prop({ required: false, type: PendingApproval })
  pendingApproval?: PendingApproval | null;

  @Prop({ required: false, type: Number, default: 0 })
  queuePosition?: number;

  @Prop({ required: false, type: String })
  threadId?: string;

  @Prop({ required: false, type: String })
  singleStepTaskId?: string;

  @Prop({ required: false, type: Boolean, default: false })
  advisorAutopilotEnabled?: boolean;

  @Prop({ required: false, type: Number })
  advisorAutopilotTargetScore?: number;

  @Prop({ required: false, type: Number })
  advisorAutopilotMaxTurns?: number;

  @Prop({ required: false, type: Boolean, default: false })
  reflectionEnabled?: boolean;

  @Prop({ required: false, type: String, enum: ADVISOR_SCORING_MODES, default: 'llm' })
  advisorScoringMode?: AdvisorScoringMode;

  @Prop({ required: false, type: [SeededTaskOutput], default: [] })
  seededTaskOutputs?: SeededTaskOutput[];

  @Prop({ required: false, type: String, enum: ['live', 'inherit', 'replay_strict', 'replay_flex', 'replay_adaptive'], default: 'live' })
  executionMode?: string;

  @Prop({ required: false, type: Object, default: {} })
  stepExecutionModes?: Record<string, string>;

  @Prop({ required: false, type: Object, default: {} })
  replayPlanningByTask?: Record<string, ReplayPlanningMetadata>;

  @Prop({ required: false, type: String })
  modelIdOverride?: string;

  createdAt?: Date;

  updatedAt?: Date;
}

export const FlowExecutionSchema = SchemaFactory.createForClass(FlowExecution);

FlowExecutionSchema.index({ flowId: 1, createdAt: -1 });
FlowExecutionSchema.index({ ownerId: 1, status: 1 });
FlowExecutionSchema.index({ ownerId: 1, status: 1, createdAt: 1 });
FlowExecutionSchema.index({ ownerId: 1, idempotencyKey: 1 });

FlowExecutionSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
