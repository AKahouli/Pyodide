import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyPlanVersionDocument = HydratedDocument<WorkyPlanVersion>;

/**
 * An immutable snapshot of the plan at a point in time. Created by the
 * plan-delta service (Part 2) when a delta is applied. `versionNumber` is
 * monotonic per stream.
 */
@Schema({
  timestamps: true,
  collection: 'worky_plan_versions',
})
export class WorkyPlanVersion extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  versionNumber!: number;

  @Prop({ type: String, enum: ['planning', 'execution', 'replan'], required: true })
  phase!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkyMessage', default: null })
  createdFromMessageId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  triggerEventId?: string | null;

  @Prop({ type: String, default: '', maxlength: 2000 })
  summary!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyPlanVersionSchema = SchemaFactory.createForClass(WorkyPlanVersion);

WorkyPlanVersionSchema.index({ streamId: 1, versionNumber: 1 }, { unique: true });

WorkyPlanVersionSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
