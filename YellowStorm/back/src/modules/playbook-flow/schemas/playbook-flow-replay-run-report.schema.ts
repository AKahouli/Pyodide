import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { ReplayMode } from './playbook-flow-validated-replay.schema';
import { FlowTaskSemanticMatch } from './playbook-flow-task-result.schema';
import type { ReplaySemanticChecklistItem } from '../interfaces/playbook-flow-replay-template.interface';

export type FlowReplayRunReportDocument = HydratedDocument<FlowReplayRunReport>;
export type ReplaySignalEvaluationStatus = 'not_evaluated' | 'not_applicable' | 'passed' | 'warning' | 'failed';

@Schema({ _id: false })
export class FlowReplayDriftFinding {
  @Prop({ required: true, type: String })
  category!: string;

  @Prop({ required: true, type: String, enum: ['info', 'warning', 'fail'] })
  severity!: 'info' | 'warning' | 'fail';

  @Prop({ required: true, type: String })
  reason!: string;
}

@Schema({ _id: false })
export class FlowReplaySignalStatus {
  @Prop({ required: true, type: String, enum: ['not_evaluated', 'not_applicable', 'passed', 'warning', 'failed'] })
  status!: ReplaySignalEvaluationStatus;

  @Prop({ required: false, type: String, default: null })
  reason!: string | null;
}

@Schema({ _id: false })
export class FlowReplayExpectedToolStep {
  @Prop({ required: true, type: Number })
  stepIndex!: number;

  @Prop({ required: true, type: String })
  toolName!: string;

  @Prop({ required: false, type: String, default: '' })
  purpose!: string;

  @Prop({ required: false, type: Boolean, default: false })
  required!: boolean;

  @Prop({ required: false, type: Object, default: {} })
  argumentShape!: Record<string, unknown>;

  @Prop({ required: false, type: [String], default: [] })
  argumentShapeKeys!: string[];

  @Prop({ required: false, type: Object, default: {} })
  expectedArgs!: Record<string, unknown>;

  @Prop({ required: false, type: Number, default: null })
  sourceCallIndex?: number | null;
}

@Schema({ _id: false })
export class FlowReplayObservedToolCall {
  @Prop({ required: true, type: Number })
  callIndex!: number;

  @Prop({ required: true, type: String })
  toolName!: string;

  @Prop({ required: false, type: String, default: null })
  purpose?: string | null;

  @Prop({ required: false, type: Object, default: {} })
  args!: Record<string, unknown>;

  @Prop({ required: false, type: String, default: null })
  outputSummary?: string | null;

  @Prop({ required: false, type: String, enum: ['completed', 'failed', 'skipped'], default: null })
  status?: 'completed' | 'failed' | 'skipped' | null;
}

@Schema({ _id: false })
export class FlowReplayToolCallComparison {
  @Prop({ required: false, type: Number, default: null })
  expectedStepIndex!: number | null;

  @Prop({ required: false, type: String, default: null })
  expectedToolName!: string | null;

  @Prop({ required: false, type: String, default: null })
  expectedPurpose!: string | null;

  @Prop({ required: false, type: Object, default: {} })
  expectedArgs!: Record<string, unknown>;

  @Prop({ required: false, type: Number, default: null })
  observedCallIndex!: number | null;

  @Prop({ required: false, type: String, default: null })
  observedToolName!: string | null;

  @Prop({ required: false, type: String, default: null })
  observedPurpose?: string | null;

  @Prop({ required: false, type: Object, default: {} })
  observedArgs!: Record<string, unknown>;

  @Prop({ required: true, type: String, enum: ['matched', 'warning', 'failed', 'missing', 'extra'] })
  status!: 'matched' | 'warning' | 'failed' | 'missing' | 'extra';

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
export class FlowReplayPostRunEvaluation {
  @Prop({ required: true, type: Boolean })
  judgeUsed!: boolean;

  @Prop({ required: false, type: String, default: null })
  judgeModel!: string | null;

  @Prop({ required: true, type: Date })
  evaluatedAt!: Date;

  @Prop({ required: true, type: String, enum: ['match', 'minor_drift', 'major_drift', 'not_comparable'] })
  verdict!: 'match' | 'minor_drift' | 'major_drift' | 'not_comparable';

  @Prop({ required: false, type: Number, default: null })
  overallScore!: number | null;

  @Prop({ required: false, type: Number, default: null })
  semanticMatchScore!: number | null;

  @Prop({ required: false, type: Number, default: null })
  outputFormatScore!: number | null;

  @Prop({ required: false, type: Number, default: null })
  toolSequenceScore!: number | null;

  @Prop({ required: false, type: Number, default: null })
  reasoningScore!: number | null;

  @Prop({ required: true, type: String })
  summary!: string;

  @Prop({ required: false, type: [String], default: [] })
  missingPoints!: string[];

  @Prop({ required: false, type: [String], default: [] })
  changedPoints!: string[];

  @Prop({ required: false, type: [String], default: [] })
  preservedPoints!: string[];

  @Prop({ required: true, type: String, enum: ['accept', 'review', 'reject'] })
  recommendedAction!: 'accept' | 'review' | 'reject';

  @Prop({ required: false, type: Object, default: null })
  rawJudgeResponse!: Record<string, unknown> | null;

  @Prop({ required: false, type: String, default: null })
  failureReason!: string | null;
}

@Schema({ timestamps: true, collection: 'playbook_flow_replay_run_reports' })
export class FlowReplayRunReport {
  @Prop({ required: true, type: String, index: true })
  executionId!: string;

  @Prop({ required: true, type: String, index: true })
  flowId!: string;

  @Prop({ required: true, type: String, index: true })
  taskId!: string;

  @Prop({ required: true, type: Number, default: 0, index: true })
  iteration!: number;

  @Prop({ required: true, type: String, index: true })
  replayId!: string;

  @Prop({ required: true, type: Number })
  validationVersion!: number;

  @Prop({ required: true, type: String })
  mode!: ReplayMode;

  @Prop({ required: true, type: Boolean })
  applied!: boolean;

  @Prop({ required: true, type: Number })
  confidenceScore!: number;

  @Prop({ required: false, type: [String], default: [] })
  appliedSections!: string[];

  @Prop({ required: false, type: [String], default: [] })
  skippedSections!: string[];

  @Prop({ required: false, type: [String], default: [] })
  invalidationReasons!: string[];

  @Prop({ required: false, type: Object, default: {} })
  confidenceFactors!: Record<string, number>;

  @Prop({ required: false, type: Boolean, default: false })
  outputContractEvaluated!: boolean;

  @Prop({ required: false, type: Boolean, default: false })
  outputContractPassed!: boolean;

  @Prop({ required: false, type: Number, default: null })
  structuralDriftScore!: number | null;

  @Prop({ required: false, type: Number, default: null })
  toolPolicyScore!: number | null;

  @Prop({ required: false, type: String, default: null })
  verdict!: 'pass' | 'warning' | 'fail' | 'skipped' | 'unknown' | null;

  @Prop({ required: false, type: Number, default: null })
  overallScore!: number | null;

  @Prop({ required: false, type: [String], default: [] })
  verdictReasons!: string[];

  @Prop({ required: false, type: [String], default: [] })
  structuralDriftReasons!: string[];

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowTaskSemanticMatch), default: null })
  semanticMatch?: FlowTaskSemanticMatch | null;

  @Prop({ required: false, type: String, default: null })
  matchedBaselineId!: string | null;

  @Prop({ required: false, type: Number, default: null })
  matchedBaselineVersion!: number | null;

  @Prop({ required: false, type: String, default: null })
  intentKey!: string | null;

  @Prop({ required: false, type: Number, default: null })
  replayConfidence!: number | null;

  @Prop({ required: false, type: Number, default: null })
  toolSequenceMatch!: number | null;

  @Prop({ required: false, type: Number, default: null })
  argumentShapeMatch!: number | null;

  @Prop({ required: false, type: Number, default: null })
  reasoningMatch!: number | null;

  @Prop({ required: false, type: Number, default: null })
  outputFormatMatch!: number | null;

  @Prop({ required: false, type: Number, default: null })
  contextDrift!: number | null;

  @Prop({ required: false, type: Number, default: null })
  dataDrift!: number | null;

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplayDriftFinding)], default: [] })
  driftFindings!: FlowReplayDriftFinding[];

  @Prop({ required: false, type: [String], default: [] })
  blockedBy!: string[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplayExpectedToolStep)], default: [] })
  expectedToolSteps!: FlowReplayExpectedToolStep[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplayObservedToolCall)], default: [] })
  observedToolCalls!: FlowReplayObservedToolCall[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplayToolCallComparison)], default: [] })
  toolCallComparisons!: FlowReplayToolCallComparison[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowReplaySemanticChecklistItem)], default: [] })
  instantiatedSemanticChecklist!: ReplaySemanticChecklistItem[];

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplaySignalStatus), default: { status: 'not_evaluated', reason: 'evaluation_pending' } })
  intentStatus!: FlowReplaySignalStatus;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplaySignalStatus), default: { status: 'not_evaluated', reason: 'evaluation_pending' } })
  reasoningStatus!: FlowReplaySignalStatus;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplaySignalStatus), default: { status: 'not_evaluated', reason: 'evaluation_pending' } })
  toolSequenceStatus!: FlowReplaySignalStatus;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplaySignalStatus), default: { status: 'not_evaluated', reason: 'evaluation_pending' } })
  argumentShapeStatus!: FlowReplaySignalStatus;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplaySignalStatus), default: { status: 'not_evaluated', reason: 'evaluation_pending' } })
  outputContractStatus!: FlowReplaySignalStatus;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplaySignalStatus), default: { status: 'not_evaluated', reason: 'evaluation_pending' } })
  semanticStatus!: FlowReplaySignalStatus;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplaySignalStatus), default: { status: 'not_evaluated', reason: 'evaluation_pending' } })
  contextSubstitutionStatus!: FlowReplaySignalStatus;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowReplayPostRunEvaluation), default: null })
  postRunEvaluation?: FlowReplayPostRunEvaluation | null;
}

export const FlowReplayRunReportSchema = SchemaFactory.createForClass(FlowReplayRunReport);

FlowReplayRunReportSchema.index({ executionId: 1, taskId: 1, iteration: 1, createdAt: -1 });
FlowReplayRunReportSchema.index({ flowId: 1, taskId: 1, iteration: 1, createdAt: -1 });
FlowReplayRunReportSchema.index({ flowId: 1, taskId: 1, replayId: 1, iteration: 1, createdAt: -1 });
FlowReplayRunReportSchema.index({ replayId: 1, createdAt: -1 });

FlowReplayRunReportSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
