import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyTaskDocument = HydratedDocument<WorkyTask>;

@Schema({ _id: false })
export class WorkyTaskBudget {
  @Prop({ type: Number, default: 0, min: 0 })
  estimateUsd!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  actualUsd!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  tokensEstimate!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  tokensActual!: number;
}

const WorkyTaskBudgetSchema = SchemaFactory.createForClass(WorkyTaskBudget);

@Schema({
  timestamps: true,
  collection: 'worky_tasks',
})
export class WorkyTask extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  /**
   * The manager's Postgres row id for this task (the Electric source of
   * truth). Upsert key for the Electric consumer; null for tasks not
   * originating from the manager.
   */
  @Prop({ type: String, default: null })
  externalId?: string | null;

  /** plan_steps.ordinal (Electric source) — step ordering within the plan. */
  @Prop({ type: Number, default: null })
  ordinal?: number | null;

  /** plan_steps.result (Electric source) — the step's output / manager answer. */
  @Prop({ type: String, default: null })
  result?: string | null;

  /** plan_steps.blocked_reason (Electric source) — why the step is blocked. */
  @Prop({ type: String, default: null })
  blockedReason?: string | null;

  /** plan_steps.wave (Electric source) — parallel wave index; steps sharing a
   *  wave ran concurrently. Null for tasks not from the orchestrator's plan. */
  @Prop({ type: Number, default: null })
  wave?: number | null;

  /** plan_steps.depends_on (Electric source), split into step_ids — NOT Mongo
   *  ids, unlike the legacy `dependsOn` field below. */
  @Prop({ type: [String], default: [] })
  dependsOnStepIds!: string[];

  @Prop({ type: String, required: true, trim: true, minlength: 1, maxlength: 200 })
  title!: string;

  @Prop({ type: String, default: '', maxlength: 5000 })
  description!: string;

  @Prop({
    type: String,
    required: true,
    enum: [
      'backlog',
      'ready',
      'running',
      'review',
      'blocked',
      'done',
      'failed',
      'canceled',
      'superseded',
      'archived',
    ],
    default: 'backlog',
    index: true,
  })
  lane!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['pending', 'confirmed', 'rejected'],
    default: 'pending',
  })
  planningStatus!: string;

  @Prop({
    type: String,
    required: true,
    enum: [
      'not_started',
      'scheduled',
      'running',
      'waiting_for_event',
      'review',
      'done',
      'failed',
      'canceled',
      'superseded',
    ],
    default: 'not_started',
  })
  executionState!: string;

  @Prop({
    type: String,
    enum: ['active', 'pause_requested', 'paused', 'stop_requested', 'stopped'],
    default: 'active',
  })
  controlState!: string;

  @Prop({ type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' })
  priority!: string;

  @Prop({
    type: String,
    enum: ['ephemeral_ai_agent', 'human_agent', 'unassigned'],
    default: 'unassigned',
  })
  assigneeType!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assigneeId?: Types.ObjectId | null;

  @Prop({ type: [Types.ObjectId], ref: 'WorkyTask', default: [] })
  dependsOn!: Types.ObjectId[];

  @Prop({ type: [String], default: [] })
  requiredTools!: string[];

  @Prop({
    type: String,
    enum: [
      'internal_analysis',
      'research',
      'drafting',
      'internal_artifact_write',
      'internal_platform_notification',
      'external_send',
      'customer_facing_release',
      'external_comms',
      'budget_overrun',
      'cancel_human_task',
      'replanning',
    ],
    default: 'internal_analysis',
  })
  actionCategory!: string;

  @Prop({ type: Date, default: null })
  theoreticalDeadlineAt?: Date | null;

  @Prop({ type: [String], default: [] })
  acceptanceCriteria!: string[];

  @Prop({ type: WorkyTaskBudgetSchema, default: () => ({}) })
  budget!: WorkyTaskBudget;

  @Prop({ type: [String], default: [] })
  waitConditions!: string[];

  @Prop({ type: Date, default: null })
  startedAt?: Date | null;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;

  @Prop({ type: Number, default: null, min: 0 })
  durationMs?: number | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyTaskSchema = SchemaFactory.createForClass(WorkyTask);

WorkyTaskSchema.index({ streamId: 1, lane: 1 });
WorkyTaskSchema.index({ streamId: 1, status: 1 });
WorkyTaskSchema.index({ streamId: 1, executionState: 1 });
WorkyTaskSchema.index({ assigneeId: 1 });
WorkyTaskSchema.index(
  { streamId: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
);

WorkyTaskSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
