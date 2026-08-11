import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyStreamDocument = HydratedDocument<WorkyStream>;

@Schema({ _id: false })
export class WorkyStreamBudget {
  @Prop({ type: Number, default: 0, min: 0 })
  limitUsd!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  limitTokens!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  spendUsd!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  tokensUsed!: number;

  @Prop({ type: String, default: 'hard_stop' })
  enforcement!: 'hard_stop' | 'notify';
}

const WorkyStreamBudgetSchema = SchemaFactory.createForClass(WorkyStreamBudget);

@Schema({
  timestamps: true,
  collection: 'worky_streams',
})
export class WorkyStream extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerUserId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId!: Types.ObjectId;

  /**
   * Legacy only. Worky streams no longer provision a dedicated artifact
   * workspace (artifacts are unused). Kept nullable so pre-existing streams
   * still resolve their workspace on delete; new streams store null.
   */
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: false, default: null })
  artifactWorkspaceId?: Types.ObjectId | null;

  /**
   * Legacy only. Worky streams no longer provision a per-stream Manager
   * agent (planner/executor/ephemeral agents resolve by agent type at turn
   * time). Kept nullable so pre-existing streams still clean up their agent
   * on delete; new streams store null.
   */
  @Prop({ type: Types.ObjectId, ref: 'Agent', required: false, default: null })
  managerAgentId?: Types.ObjectId | null;

  /**
   * Per-stream model selection. Both fields store the **LiteLLM
   * model identifier** (e.g. `gpt-4o-mini`, `claude-3-5-sonnet-…`)
   * — the value `LiteLlm(model=...)` expects. Never the admin DB
   * model id. Resolved at planning / execution time by the
   * `WorkyPlanningService` with the fallback chain:
   *   1. per-turn request override,
   *   2. this stream field,
   *   3. admin default model (Admin > Models).
   * Null = use the next step in the chain.
   */
  @Prop({ type: String, default: null, trim: true, maxlength: 256 })
  managerModelId?: string | null;

  @Prop({ type: String, default: null, trim: true, maxlength: 256 })
  workerModelId?: string | null;

  /**
   * CompanionAi session id for this stream. Created via the gRPC
   * `CreateSession` RPC when the stream is created, and used as the
   * `session_id` on every `RunTask` kickoff and as the Electric shape
   * scope key (`session_id`) the manager writes task rows under.
   */
  @Prop({ type: String, default: null, index: true })
  aiSessionId?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'WorkyGovernancePolicy', default: null })
  governancePolicyRef?: Types.ObjectId | null;

  @Prop({ type: String, required: true, trim: true, minlength: 1, maxlength: 200 })
  title!: string;

  @Prop({
    type: String,
    required: true,
    enum: [
      'created',
      'planning',
      'start_requested',
      'start_validation_failed',
      'active',
      'partially_blocked',
      'waiting_for_owner',
      'waiting_for_human',
      'waiting_for_budget_decision',
      'paused',
      'stopped',
      'completed',
      'archived',
    ],
    default: 'created',
    index: true,
  })
  status!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['active', 'pause_requested', 'paused', 'resume_requested', 'stop_requested', 'stopped'],
    default: 'active',
  })
  controlState!: string;

  @Prop({ type: Boolean, default: false, index: true })
  schedulerEnabled!: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  currentPlanVersion!: number;

  @Prop({ type: Number, default: null })
  executionPlanVersion?: number | null;

  @Prop({ type: WorkyStreamBudgetSchema, default: () => ({}) })
  budget!: WorkyStreamBudget;

  @Prop({ type: Date, default: null })
  startedAt?: Date | null;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;

  @Prop({ type: Number, default: 0, min: 0 })
  activeDurationMinutes!: number;

  @Prop({ type: Date, default: () => new Date() })
  lastActivityAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyStreamSchema = SchemaFactory.createForClass(WorkyStream);

WorkyStreamSchema.index({ ownerUserId: 1, createdAt: -1 });
WorkyStreamSchema.index({ ownerUserId: 1, status: 1 });
WorkyStreamSchema.index({ artifactWorkspaceId: 1 });
WorkyStreamSchema.index({ managerAgentId: 1 });

WorkyStreamSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
