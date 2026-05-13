import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type PlaybookEvaluationExecutionDocument = HydratedDocument<PlaybookEvaluationExecution>;

@Schema({ _id: false })
export class PlaybookEvaluationExecutionFinding {
  @Prop({ type: String, enum: ['info', 'warning', 'error'], required: true })
  severity!: string;

  @Prop({ type: String, enum: ['semantic', 'reference', 'artifact', 'format', 'evidence', 'execution'], required: true })
  category!: string;

  @Prop({ type: String, default: null })
  sourceTaskId!: string | null;

  @Prop({ type: String, required: true })
  message!: string;
}

export const PlaybookEvaluationExecutionFindingSchema = SchemaFactory.createForClass(PlaybookEvaluationExecutionFinding);

@Schema({ _id: false })
export class PlaybookEvaluationExecutionMetrics {
  @Prop({ type: Number, default: 0 })
  connectedInputCount!: number;

  @Prop({ type: Number, default: 0 })
  artifactCount!: number;

  @Prop({ type: Number, default: 0 })
  completedUpstreamSteps!: number;

  @Prop({ type: Number, default: 0 })
  failedUpstreamSteps!: number;

  @Prop({ type: Number, default: null })
  totalDurationMs!: number | null;
}

export const PlaybookEvaluationExecutionMetricsSchema = SchemaFactory.createForClass(PlaybookEvaluationExecutionMetrics);

@Schema({ timestamps: true, collection: 'playbook_evaluation_executions' })
export class PlaybookEvaluationExecution extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Playbook', required: true, index: true })
  playbookId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PlaybookExecution', required: true, index: true })
  executionId!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  evaluationTaskId!: string;

  @Prop({ type: String, required: true })
  evaluationTaskTitle!: string;

  @Prop({ type: Types.ObjectId, ref: 'PlaybookEvaluationBaseline', default: null })
  baselineId!: Types.ObjectId | null;

  @Prop({ type: String, enum: ['semantic', 'reference', 'hybrid'], required: true })
  mode!: string;

  @Prop({ type: String, enum: ['running', 'completed', 'failed'], required: true, default: 'completed' })
  status!: string;

  @Prop({ type: Number, default: null })
  score!: number | null;

  @Prop({ type: String, enum: ['pass', 'warning', 'fail'], default: null })
  verdict!: string | null;

  @Prop({ type: Number, default: null })
  semanticScore!: number | null;

  @Prop({ type: Number, default: null })
  referenceScore!: number | null;

  @Prop({ type: Number, default: null })
  artifactScore!: number | null;

  @Prop({ type: Number, default: null })
  formatScore!: number | null;

  @Prop({ type: Number, default: null })
  evidenceScore!: number | null;

  @Prop({ type: Number, default: null })
  executionHealthScore!: number | null;

  @Prop({ type: String, default: '' })
  expectation!: string;

  @Prop({ type: String, required: true, default: 'evaluation-node-v1' })
  rubricVersion!: string;

  @Prop({ type: String, default: null })
  judgeModel!: string | null;

  @Prop({ type: String, default: null })
  summary!: string | null;

  @Prop({ type: [PlaybookEvaluationExecutionFindingSchema], default: [], _id: false })
  findings!: PlaybookEvaluationExecutionFinding[];

  @Prop({ type: PlaybookEvaluationExecutionMetricsSchema, default: () => ({}) })
  metrics!: PlaybookEvaluationExecutionMetrics;

  @Prop({ type: Date, default: Date.now })
  startedAt!: Date;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ type: String, default: null })
  error!: string | null;
}

export const PlaybookEvaluationExecutionSchema = SchemaFactory.createForClass(PlaybookEvaluationExecution);
PlaybookEvaluationExecutionSchema.index({ playbookId: 1, evaluationTaskId: 1, createdAt: -1 });
