import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyPlanDeltaDocument = HydratedDocument<WorkyPlanDelta>;

/**
 * A single plan mutation submitted by the Manager. Validation/versioning
 * logic lives in `worky-plan-delta.service.ts` (Part 2). The delta body
 * (`create_tasks|update_tasks|cancel_tasks|clarification_requests`) is stored
 * as opaque JSON — its shape is defined by the runtime contract §6.2.
 */
@Schema({
  timestamps: true,
  collection: 'worky_plan_deltas',
})
export class WorkyPlanDelta extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  basePlanVersion!: number;

  @Prop({ type: Number, default: null })
  resultPlanVersion?: number | null;

  @Prop({ type: String, enum: ['planning', 'execution', 'replan'], required: true })
  phase!: string;

  @Prop({ type: String, required: true })
  triggerEventId!: string;

  @Prop({
    type: String,
    enum: ['pending', 'applied', 'rejected', 'superseded', 'pending_approval'],
    required: true,
    default: 'pending',
  })
  status!: string;

  @Prop({ type: String, enum: ['auto', 'manual'], default: 'auto' })
  applyMode!: string;

  @Prop({ type: String, default: '', maxlength: 2000 })
  reason!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Object, default: {} })
  body!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyPlanDeltaSchema = SchemaFactory.createForClass(WorkyPlanDelta);

WorkyPlanDeltaSchema.index({ streamId: 1, createdAt: -1 });
WorkyPlanDeltaSchema.index({ streamId: 1, status: 1 });

WorkyPlanDeltaSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
