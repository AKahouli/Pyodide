import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlowEvaluationExecutionDocument = HydratedDocument<FlowEvaluationExecution>;

@Schema({ _id: false })
export class FlowEvaluationFinding {
  @Prop({ required: true, type: String, enum: ['info', 'warning', 'error'] })
  severity!: string;

  @Prop({
    required: true,
    type: String,
    enum: ['semantic', 'reference', 'artifact', 'format', 'evidence', 'execution'],
  })
  category!: string;

  @Prop({ required: false, type: String })
  sourceTaskId?: string;

  @Prop({ required: true, type: String })
  message!: string;
}

@Schema({ _id: false })
export class FlowEvaluationMetrics {
  @Prop({ required: false, type: Number, default: 0 })
  connectedInputCount?: number;

  @Prop({ required: false, type: Number, default: 0 })
  artifactCount?: number;

  @Prop({ required: false, type: Number, default: 0 })
  completedUpstreamSteps?: number;

  @Prop({ required: false, type: Number, default: 0 })
  failedUpstreamSteps?: number;

  @Prop({ required: false, type: Number })
  totalDurationMs?: number;
}

@Schema({ timestamps: true, collection: 'playbook_flow_evaluation_executions' })
export class FlowEvaluationExecution {
  @Prop({ required: true, type: String, index: true })
  flowId!: string;

  @Prop({ required: true, type: String, index: true })
  executionId!: string;

  @Prop({ required: true, type: String, index: true })
  taskId!: string;

  @Prop({ required: true, type: Number, default: 0 })
  iteration!: number;

  @Prop({ required: true, type: String })
  taskTitle!: string;

  @Prop({ required: false, type: String })
  baselineId?: string;

  @Prop({ required: true, type: String, enum: ['semantic', 'reference', 'hybrid'] })
  mode!: string;

  @Prop({ required: true, type: String, enum: ['running', 'completed', 'failed'], default: 'completed' })
  status!: string;

  @Prop({ required: false, type: Number })
  score?: number;

  @Prop({ required: false, type: String, enum: ['pass', 'warning', 'fail'] })
  verdict?: string;

  @Prop({ required: false, type: Number })
  semanticScore?: number;

  @Prop({ required: false, type: Number })
  referenceScore?: number;

  @Prop({ required: false, type: Number })
  artifactScore?: number;

  @Prop({ required: false, type: Number })
  formatScore?: number;

  @Prop({ required: false, type: Number })
  evidenceScore?: number;

  @Prop({ required: false, type: Number })
  executionHealthScore?: number;

  @Prop({ required: false, type: String, default: '' })
  expectation?: string;

  @Prop({ required: false, type: String, default: 'evaluation-node-v1' })
  rubricVersion?: string;

  @Prop({ required: false, type: String })
  judgeModel?: string;

  @Prop({ required: false, type: String })
  summary?: string;

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowEvaluationFinding)], default: [] })
  findings!: FlowEvaluationFinding[];

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowEvaluationMetrics), default: () => ({}) })
  metrics!: FlowEvaluationMetrics;

  @Prop({ required: false, type: Date, default: Date.now })
  startedAt?: Date;

  @Prop({ required: false, type: Date })
  completedAt?: Date;

  @Prop({ required: false, type: String })
  error?: string;
}

export const FlowEvaluationExecutionSchema = SchemaFactory.createForClass(FlowEvaluationExecution);

FlowEvaluationExecutionSchema.index({ flowId: 1, taskId: 1, iteration: 1, createdAt: -1 });

FlowEvaluationExecutionSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
