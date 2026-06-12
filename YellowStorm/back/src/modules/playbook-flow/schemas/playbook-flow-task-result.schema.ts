import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ADVISOR_SCORING_MODES, AdvisorScoringMode } from './playbook-flow.schema';

export type FlowTaskResultDocument = HydratedDocument<FlowTaskResult>;

@Schema({ _id: false })
export class FlowTaskToolTraceItem {
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
  status?: string | null;

  @Prop({ required: false, type: Number, default: null })
  durationMs?: number | null;

  @Prop({ required: false, type: String, default: null })
  error?: string | null;
}

@Schema({ _id: false })
export class FlowTaskLlmPromptTraceItem {
  @Prop({ required: true, type: String })
  stage!: string;

  @Prop({ required: true, type: String })
  model!: string;

  @Prop({ required: true, type: String })
  prompt!: string;
}

@Schema({ _id: false })
export class FlowTaskPublicReasoningTraceItem {
  @Prop({ required: true, type: String })
  id!: string;

  @Prop({ required: true, type: String })
  type!: string;

  @Prop({ required: true, type: String })
  label!: string;

  @Prop({ required: true, type: String })
  description!: string;

  @Prop({ required: false, type: Number, default: null })
  confidence?: number | null;
}

@Schema({ _id: false })
export class FlowTaskUsage {
  @Prop({ required: false, type: Number, default: null })
  inputTokens?: number | null;

  @Prop({ required: false, type: Number, default: null })
  outputTokens?: number | null;

  @Prop({ required: false, type: Number, default: null })
  totalTokens?: number | null;

  @Prop({ required: false, type: String, default: null })
  model?: string | null;
}

@Schema({ _id: false })
export class FlowTaskSemanticFinding {
  @Prop({ required: false, type: String, default: null })
  key?: string | null;

  @Prop({ required: false, type: String, default: null })
  expected?: string | null;

  @Prop({ required: false, type: String, default: null })
  observed?: string | null;

  @Prop({ required: true, type: String, enum: ['info', 'warning', 'fail'] })
  severity!: 'info' | 'warning' | 'fail';
}

@Schema({ _id: false })
export class FlowTaskSemanticMatch {
  @Prop({ required: false, type: Number })
  matchScore?: number;

  @Prop({ required: false, type: Number })
  semanticSimilarityScore?: number;

  @Prop({ required: false, type: Number })
  evidenceConsistencyScore?: number;

  @Prop({ required: false, type: Number })
  judgeScore?: number;

  @Prop({ required: false, type: String })
  reason?: string;

  @Prop({ required: false, type: [String], default: [] })
  missingPoints?: string[];

  @Prop({ required: false, type: [String], default: [] })
  changedPoints?: string[];

  @Prop({ required: false, type: [String], default: [] })
  preservedPoints?: string[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowTaskSemanticFinding)], default: [] })
  missingPointFindings?: FlowTaskSemanticFinding[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowTaskSemanticFinding)], default: [] })
  changedPointFindings?: FlowTaskSemanticFinding[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowTaskSemanticFinding)], default: [] })
  extraPointFindings?: FlowTaskSemanticFinding[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowTaskSemanticFinding)], default: [] })
  staleContextReferenceFindings?: FlowTaskSemanticFinding[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowTaskSemanticFinding)], default: [] })
  unsupportedClaimFindings?: FlowTaskSemanticFinding[];

  @Prop({ required: false, type: String, default: null })
  evaluationSource?: 'instantiated_replay' | 'runtime' | 'unknown' | null;

  @Prop({ required: false, type: String })
  model?: string;

  @Prop({ required: false, type: Boolean })
  judgeUsed?: boolean;
}

@Schema({ _id: false })
export class FlowTaskJudgeResult {
  @Prop({ required: false, type: Number, default: 0 })
  accuracyScore?: number;

  @Prop({ required: false, type: Number, default: 0 })
  completenessScore?: number;

  @Prop({ required: false, type: Number, default: 0 })
  resultMatchingScore?: number;

  @Prop({ required: false, type: Number, default: 0 })
  overallScore?: number;

  @Prop({ required: false, type: Number, default: 0 })
  confidence?: number;

  @Prop({ required: false, type: Number, default: 0 })
  toolUsageScore?: number;

  @Prop({ required: false, type: String, default: 'none' })
  expectedResultSource?: string;

  @Prop({ required: false, type: String, default: 'none' })
  expectedResultType?: string;

  @Prop({ required: false, type: Boolean, default: false })
  expectedResultMatched?: boolean;

  @Prop({ required: false, type: String, default: '' })
  expectedResultReason?: string;

  @Prop({ required: false, type: [String], default: [] })
  missingFacts?: string[];

  @Prop({ required: false, type: [String], default: [] })
  incoherences?: string[];

  @Prop({ required: false, type: [String], default: [] })
  unsupportedClaims?: string[];

  @Prop({ required: false, type: [String], default: [] })
  handoffRisks?: string[];

  @Prop({ required: false, type: [String], default: [] })
  rewriteHints?: string[];

  @Prop({ required: false, type: [String], default: [] })
  toolSelectionIssues?: string[];

  @Prop({ required: false, type: [String], default: [] })
  missingToolCalls?: string[];

  @Prop({ required: false, type: [String], default: [] })
  redundantToolCalls?: string[];

  @Prop({ required: false, type: [String], default: [] })
  toolOutputUseIssues?: string[];

  @Prop({ required: false, type: [String], default: [] })
  toolSequencingIssues?: string[];

  @Prop({ required: false, type: [String], default: [] })
  toolUsageStrengths?: string[];

  @Prop({ required: false, type: String, default: '' })
  toolUsageRecommendation?: string;

  @Prop({ required: false, type: String, default: 'none' })
  safeAutoFixType?: string;

  @Prop({ required: false, type: String, default: 'none' })
  recommendation?: string;

  @Prop({ required: false, type: String, default: '' })
  reason?: string;
}

@Schema({ _id: false })
export class FlowTaskJudgeHistoryEntry {
  @Prop({ required: true, type: String })
  id!: string;

  @Prop({ required: true, type: Date })
  createdAt!: Date;

  @Prop({ required: false, type: Number, default: null })
  attemptNumber?: number | null;

  @Prop({ required: false, type: String, default: null })
  model?: string | null;

  @Prop({ required: false, type: String, enum: ADVISOR_SCORING_MODES, default: 'llm' })
  scoringMode?: AdvisorScoringMode;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowTaskUsage), default: null })
  usage?: FlowTaskUsage | null;

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowTaskLlmPromptTraceItem)], default: [] })
  llmPromptTrace?: FlowTaskLlmPromptTraceItem[];

  @Prop({ required: true, type: SchemaFactory.createForClass(FlowTaskJudgeResult) })
  judgeResult!: FlowTaskJudgeResult;
}

@Schema({ timestamps: true })
export class FlowTaskResult {
  @Prop({ required: true, type: String })
  executionId!: string;

  @Prop({ required: true, type: String })
  taskId!: string;

  @Prop({ required: true, type: Number, default: 0 })
  iteration!: number;

  @Prop({ required: true, type: String, enum: ['pending', 'running', 'completed', 'failed', 'skipped', 'cancelled'], default: 'pending' })
  status!: string;

  @Prop({ required: false, type: Object })
  output?: unknown;

  @Prop({ required: false, type: String })
  displayText?: string;

  @Prop({ required: false, type: Object })
  outputs?: Record<string, unknown>;

  @Prop({ required: false, type: [Object], default: undefined })
  artifacts?: Array<Record<string, unknown>>;

  @Prop({ required: false, type: [Object], default: undefined })
  components?: Array<Record<string, unknown>>;

  @Prop({ required: false, type: String })
  error?: string;

  @Prop({ required: false, type: Date })
  startedAt?: Date;

  @Prop({ required: false, type: Date })
  endedAt?: Date;

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowTaskToolTraceItem)], default: [] })
  toolTrace?: FlowTaskToolTraceItem[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowTaskPublicReasoningTraceItem)], default: [] })
  reasoningChain?: FlowTaskPublicReasoningTraceItem[];

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowTaskLlmPromptTraceItem)], default: [] })
  llmPromptTrace?: FlowTaskLlmPromptTraceItem[];

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowTaskUsage), default: null })
  usage?: FlowTaskUsage | null;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowTaskSemanticMatch), default: null })
  semanticMatch?: FlowTaskSemanticMatch | null;

  @Prop({ required: false, type: Object, default: {} })
  traceMetadata?: Record<string, unknown>;

  @Prop({ required: false, type: String, enum: ['idle', 'evaluating', 'evaluated', 'failed'], default: 'idle' })
  judgeStatus?: string;

  @Prop({ required: false, type: SchemaFactory.createForClass(FlowTaskJudgeResult), default: null })
  judgeResult?: FlowTaskJudgeResult | null;

  @Prop({ required: false, type: String, enum: ADVISOR_SCORING_MODES, default: null })
  judgeScoringMode?: AdvisorScoringMode | null;

  @Prop({ required: false, type: String, default: null })
  judgeError?: string | null;

  @Prop({ required: false, type: [SchemaFactory.createForClass(FlowTaskJudgeHistoryEntry)], default: [] })
  judgeHistory?: FlowTaskJudgeHistoryEntry[];
}

export const FlowTaskResultSchema = SchemaFactory.createForClass(FlowTaskResult);

FlowTaskResultSchema.index({ executionId: 1, taskId: 1, iteration: 1 }, { unique: true });
FlowTaskResultSchema.index({ executionId: 1, taskId: 1 });

FlowTaskResultSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
