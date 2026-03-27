import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type PlaybookValidatedReplayDocument = HydratedDocument<PlaybookValidatedReplay>;

export enum ReplayValidationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export enum ReplayValidationMode {
  STRICT_REPLAY = 'strict_replay',
}

export enum ReplayFormatGuideStatus {
  DISABLED = 'disabled',
  PENDING = 'pending',
  READY = 'ready',
  FAILED = 'failed',
}

@Schema({ _id: false })
export class ReplayToolCall {
  @Prop({ type: Number, required: true })
  callIndex!: number;

  @Prop({ type: String, required: true })
  toolName!: string;

  @Prop({ type: Object, default: {} })
  args!: Record<string, unknown>;

  @Prop({ type: String, default: null })
  outputSummary!: string | null;
}

export const ReplayToolCallSchema = SchemaFactory.createForClass(ReplayToolCall);

@Schema({ _id: false })
export class ReplayLLMPromptTraceItem {
  @Prop({ type: String, required: true })
  stage!: string;

  @Prop({ type: String, required: true })
  model!: string;

  @Prop({ type: String, required: true })
  prompt!: string;
}

export const ReplayLLMPromptTraceItemSchema = SchemaFactory.createForClass(ReplayLLMPromptTraceItem);

@Schema({ timestamps: true, collection: 'playbook_validated_replays' })
export class PlaybookValidatedReplay extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Playbook', required: true, index: true })
  playbookId!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  taskId!: string;

  @Prop({ type: String, required: true })
  taskTitle!: string;

  @Prop({ type: String, default: '' })
  referenceTaskDescription!: string;

  @Prop({ type: String, default: null })
  referenceAssignedAgentId!: string | null;

  @Prop({ type: [String], default: [] })
  referenceWorkspaceIds!: string[];

  @Prop({ type: String, default: '' })
  agentName!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PlaybookExecution', required: true, index: true })
  referenceExecutionId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  referenceExecutionNumber!: number;

  @Prop({ type: Number, required: true })
  validationVersion!: number;

  @Prop({ type: String, enum: ReplayValidationStatus, default: ReplayValidationStatus.ACTIVE })
  status!: ReplayValidationStatus;

  @Prop({ type: String, enum: ReplayValidationMode, default: ReplayValidationMode.STRICT_REPLAY })
  mode!: ReplayValidationMode;

  @Prop({ type: [ReplayToolCallSchema], default: [] })
  toolCalls!: ReplayToolCall[];

  @Prop({ type: String, default: null })
  referenceOutput!: string | null;

  @Prop({ type: Boolean, default: false })
  preserveOutputFormat!: boolean;

  @Prop({ type: String, default: null })
  outputFormatGuide!: string | null;

  @Prop({ type: String, enum: ReplayFormatGuideStatus, default: ReplayFormatGuideStatus.DISABLED })
  formatGuideStatus!: ReplayFormatGuideStatus;

  @Prop({ type: String, default: null })
  formatGuideError!: string | null;

  @Prop({ type: [ReplayLLMPromptTraceItemSchema], default: [] })
  llmPromptTrace!: ReplayLLMPromptTraceItem[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const PlaybookValidatedReplaySchema = SchemaFactory.createForClass(PlaybookValidatedReplay);

PlaybookValidatedReplaySchema.index({ playbookId: 1, taskId: 1, validationVersion: -1 }, { unique: true });
PlaybookValidatedReplaySchema.index({ playbookId: 1, taskId: 1, status: 1 });

PlaybookValidatedReplaySchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
