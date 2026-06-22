import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyScheduledEventDocument = HydratedDocument<WorkyScheduledEvent>;

/**
 * Durable reminder/deadline/timeout timer. The NestJS scheduler worker
 * (Part 3 `worky-scheduler.service.ts`) claims due rows with
 * `findOneAndUpdate` + a `claimToken` lease, fires them, then marks
 * `fired`. Status-gated no-op if the task is already terminal.
 */
@Schema({
  timestamps: true,
  collection: 'worky_scheduled_events',
})
export class WorkyScheduledEvent extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkyTask', default: null, index: true })
  taskId?: Types.ObjectId | null;

  @Prop({ type: String, required: true, maxlength: 100 })
  eventType!: string;

  @Prop({ type: Date, required: true, index: true })
  fireAt!: Date;

  @Prop({ type: String, enum: ['pending', 'claimed', 'fired', 'canceled'], required: true, default: 'pending' })
  status!: string;

  @Prop({ type: String, default: null, maxlength: 64 })
  claimToken?: string | null;

  @Prop({ type: Date, default: null })
  claimedAt?: Date | null;

  @Prop({ type: Date, default: null })
  firedAt?: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyScheduledEventSchema = SchemaFactory.createForClass(WorkyScheduledEvent);

WorkyScheduledEventSchema.index({ status: 1, fireAt: 1 });
WorkyScheduledEventSchema.index({ streamId: 1, status: 1 });

WorkyScheduledEventSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicitany
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
