import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WorkyPlanStepComponentDocument = WorkyPlanStepComponent & Document;

@Schema({ timestamps: true, collection: 'worky_plan_step_components' })
export class WorkyPlanStepComponent extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  /** The manager's Postgres `plan_step_components.component_id` — idempotent upsert key. */
  @Prop({ type: String, default: null })
  externalId?: string | null;

  /** Parent step: Postgres `plan_steps.step_id` (== WorkyTask.externalId). */
  @Prop({ type: String, required: true, index: true })
  stepExternalId!: string;

  @Prop({ type: Number, default: 0 })
  ordinal!: number;

  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: Object, default: {} })
  data!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyPlanStepComponentSchema = SchemaFactory.createForClass(WorkyPlanStepComponent);

WorkyPlanStepComponentSchema.index({ streamId: 1, stepExternalId: 1, ordinal: 1 });
WorkyPlanStepComponentSchema.index(
  { streamId: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
);
WorkyPlanStepComponentSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
