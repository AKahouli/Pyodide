import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlowDynamicReasoningAttemptDocument = HydratedDocument<FlowDynamicReasoningAttempt>;

@Schema({ timestamps: true, collection: 'playbook_flow_dynamic_reasoning_attempts' })
export class FlowDynamicReasoningAttempt {
  @Prop({ required: true, type: String }) executionId!: string;
  @Prop({ required: true, type: String }) flowId!: string;
  @Prop({ required: true, type: String }) parentTaskId!: string;
  @Prop({ required: true, type: Number, default: 0 }) parentIteration!: number;
  @Prop({ required: true, type: Number, default: 0 }) attempt!: number;
  @Prop({ required: false, type: String }) subgraphId?: string;
  @Prop({ required: true, type: String, enum: ['planning', 'direct', 'running', 'completed', 'failed'], default: 'planning' }) status!: string;
  @Prop({ required: false, type: String }) taskFingerprint?: string;
  @Prop({ required: false, type: String }) contextFingerprint?: string;
  @Prop({ required: false, type: Object }) inputContextSummary?: Record<string, unknown>;
  @Prop({ required: false, type: Object }) policySnapshot?: Record<string, unknown>;
  @Prop({ required: false, type: Object }) plannerSnapshot?: Record<string, unknown>;
  @Prop({ required: false, type: Object }) decision?: Record<string, unknown>;
  @Prop({ required: false, type: [Object], default: [] }) revisions!: Array<Record<string, unknown>>;
  @Prop({ required: false, type: Number }) acceptedRevision?: number;
  @Prop({ required: false, type: Object }) acceptedPlan?: Record<string, unknown>;
  @Prop({ required: false, type: String }) fallbackReason?: string;
  @Prop({ required: false, type: Object }) error?: Record<string, unknown>;
  @Prop({ required: false, type: Date }) planningStartedAt?: Date;
  @Prop({ required: false, type: Date }) acceptedAt?: Date;
  @Prop({ required: false, type: Date }) completedAt?: Date;
}

export const FlowDynamicReasoningAttemptSchema = SchemaFactory.createForClass(FlowDynamicReasoningAttempt);
FlowDynamicReasoningAttemptSchema.index({ executionId: 1, parentTaskId: 1, parentIteration: 1, attempt: 1 }, { unique: true });
FlowDynamicReasoningAttemptSchema.index({ executionId: 1, status: 1 });
FlowDynamicReasoningAttemptSchema.index({ subgraphId: 1 }, { unique: true, sparse: true });
