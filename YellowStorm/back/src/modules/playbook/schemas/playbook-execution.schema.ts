import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type PlaybookExecutionDocument = HydratedDocument<PlaybookExecution>;

export enum ExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  INTERRUPTED = 'interrupted',
  CANCELLED = 'cancelled',
}

export enum StepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

@Schema({ _id: false })
export class TaskEvaluationHistoryEntry {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Number, default: null })
  attemptNumber!: number | null;

  @Prop({ type: String, enum: ['manual', 'auto'], default: 'manual' })
  trigger!: 'manual' | 'auto';

  @Prop({ type: String, default: null })
  baselineReplayId!: string | null;

  @Prop({ type: Number, default: null })
  baselineValidationVersion!: number | null;

  @Prop({ type: Object, required: true })
  semanticMatch!: {
    matchScore: number;
    semanticSimilarityScore: number;
    evidenceConsistencyScore: number;
    judgeScore: number;
    reason: string;
    missingPoints: string[];
    changedPoints: string[];
    model: string;
    judgeUsed: boolean;
  };
}

export const TaskEvaluationHistoryEntrySchema = SchemaFactory.createForClass(TaskEvaluationHistoryEntry);

@Schema({ _id: false })
export class TaskStepExecutionEntry {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: Number, default: null })
  attemptNumber!: number | null;

  @Prop({ type: String, required: true })
  status!: string;

  @Prop({ type: String, default: null })
  output!: string | null;

  @Prop({ type: String, default: null })
  error!: string | null;

  @Prop({ type: Number, default: null })
  durationMs!: number | null;

  @Prop({ type: Date, default: null })
  startedAt!: Date | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ type: [{ type: Object }], default: [] })
  components!: Array<{ id: string; type: string; data: Record<string, unknown> }>;

  @Prop({ type: [{ type: Object }], default: [] })
  toolTrace!: Array<{
    callIndex: number;
    toolName: string;
    args: Record<string, unknown>;
    outputSummary: string | null;
  }>;

  @Prop({ type: [{ type: Object }], default: [] })
  llmPromptTrace!: Array<{
    stage: string;
    model: string;
    prompt: string;
  }>;

  @Prop({ type: Number, default: null })
  inputTokens!: number | null;

  @Prop({ type: Number, default: null })
  outputTokens!: number | null;

  @Prop({ type: Number, default: null })
  totalTokens!: number | null;

  @Prop({ type: String, default: null })
  modelName!: string | null;

  @Prop({ type: [{ type: Object }], default: [] })
  artifacts!: Array<{
    portId: string;
    artifactKind: string;
    content?: string;
    url?: string;
    filename?: string;
    mimeType?: string;
    size?: number;
    metadata?: Record<string, unknown>;
  }>;
}

export const TaskStepExecutionEntrySchema = SchemaFactory.createForClass(TaskStepExecutionEntry);

@Schema({ _id: false })
export class TaskResult {
  @Prop({ type: String, required: true })
  taskId!: string;

  @Prop({ type: String, required: true })
  nodeTitle!: string;

  @Prop({ type: String, default: '' })
  agentName!: string;

  @Prop({ type: Number, required: true })
  order!: number;

  @Prop({ type: String, enum: StepStatus, default: StepStatus.PENDING })
  status!: StepStatus;

  @Prop({ type: String, default: null })
  output!: string | null;

  @Prop({ type: String, default: null })
  error!: string | null;

  @Prop({ type: Number, default: null })
  durationMs!: number | null;

  @Prop({ type: Date, default: null })
  startedAt!: Date | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ type: [{ type: Object }], default: [] })
  components!: Array<{ id: string; type: string; data: Record<string, unknown> }>;

  @Prop({ type: [{ type: Object }], default: [] })
  toolTrace!: Array<{
    callIndex: number;
    toolName: string;
    args: Record<string, unknown>;
    outputSummary: string | null;
  }>;

  @Prop({ type: [{ type: Object }], default: [] })
  llmPromptTrace!: Array<{
    stage: string;
    model: string;
    prompt: string;
  }>;

  @Prop({ type: Number, default: null })
  inputTokens!: number | null;

  @Prop({ type: Number, default: null })
  outputTokens!: number | null;

  @Prop({ type: Number, default: null })
  totalTokens!: number | null;

  @Prop({ type: String, default: null })
  modelName!: string | null;

  @Prop({ type: Object, default: null })
  semanticMatch!: {
    matchScore: number;
    semanticSimilarityScore: number;
    evidenceConsistencyScore: number;
    judgeScore: number;
    reason: string;
    missingPoints: string[];
    changedPoints: string[];
    model: string;
    judgeUsed: boolean;
  } | null;

  @Prop({ type: [TaskEvaluationHistoryEntrySchema], default: [] })
  evaluationHistory!: TaskEvaluationHistoryEntry[];

  @Prop({ type: [TaskStepExecutionEntrySchema], default: [] })
  stepExecutions!: TaskStepExecutionEntry[];

  @Prop({ type: Number, default: 1 })
  attemptNumber!: number;

  @Prop({ type: Boolean, default: false })
  isStale!: boolean;

  @Prop({ type: String, default: null })
  staleReason!: string | null;

  @Prop({ type: String, default: null })
  invalidatedByTaskId!: string | null;

  @Prop({ type: [{ type: Object }], default: [] })
  artifacts!: Array<{
    portId: string;
    artifactKind: string;
    content?: string;
    url?: string;
    filename?: string;
    mimeType?: string;
    size?: number;
    metadata?: Record<string, unknown>;
  }>;
}

export const TaskResultSchema = SchemaFactory.createForClass(TaskResult);

@Schema({ timestamps: true, collection: 'playbook_executions' })
export class PlaybookExecution extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Playbook', required: true, index: true })
  playbookId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  executedBy!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  executionNumber!: number;

  @Prop({ type: Number, default: 1 })
  currentAttemptNumber!: number;

  @Prop({ type: String, enum: ExecutionStatus, default: ExecutionStatus.PENDING })
  status!: ExecutionStatus;

  @Prop({ type: [TaskResultSchema], default: [] })
  taskResults!: TaskResult[];

  @Prop({ type: String, default: null })
  threadId!: string | null;

  @Prop({ type: Object, default: null })
  interruptPayload!: Record<string, unknown> | null;

  @Prop({ type: String, default: null })
  error!: string | null;

  @Prop({ type: Number, default: null })
  durationMs!: number | null;

  @Prop({ type: Date, default: null })
  startedAt!: Date | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ type: String, default: null })
  singleStepTaskId!: string | null;

  @Prop({ type: String, default: 'live' })
  executionMode!: string;

  @Prop({ type: String, enum: ['manual', 'scheduled'], default: 'manual' })
  executionTrigger!: 'manual' | 'scheduled';

  @Prop({ type: Boolean, default: false })
  runEvaluation!: boolean;

  @Prop({ type: Object, default: null })
  replaySourceByTask!: Record<string, { replayId: string; validationVersion: number }> | null;

  @Prop({ type: Object, default: null })
  playbookSnapshot!: Record<string, unknown> | null;

  @Prop({ type: Number, default: 0 })
  totalInputTokens!: number;

  @Prop({ type: Number, default: 0 })
  totalOutputTokens!: number;

  @Prop({ type: Number, default: 0 })
  totalTokens!: number;

  @Prop({ type: [{ type: Object }], default: [] })
  attemptHistory!: Array<{
    attemptNumber: number;
    type: 'initial' | 'resume_interrupt' | 'rerun_step' | 'resume_from_step';
    taskId?: string | null;
    threadId?: string | null;
    startedAt: Date;
    completedAt?: Date | null;
  }>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PlaybookExecutionSchema = SchemaFactory.createForClass(PlaybookExecution);

PlaybookExecutionSchema.index({ playbookId: 1, createdAt: -1 });
PlaybookExecutionSchema.index({ executedBy: 1, createdAt: -1 });
PlaybookExecutionSchema.index({ playbookId: 1, status: 1 });

PlaybookExecutionSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
