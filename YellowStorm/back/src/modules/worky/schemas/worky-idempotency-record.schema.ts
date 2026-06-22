import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyIdempotencyRecordDocument = HydratedDocument<WorkyIdempotencyRecord>;

/**
 * `(streamId, eventId)` is the canonical idempotency key for every runtime →
 * NestJS callback. The unique compound index is the dedup primitive
 * (canonical §3.3 + §4.1 "Idempotency"). Concurrent inserters race on the
 * index; the loser gets a duplicate-key error and treats the request as a
 * replay.
 */
@Schema({
  timestamps: { createdAt: 'handledAt', updatedAt: false },
  collection: 'worky_idempotency_records',
})
export class WorkyIdempotencyRecord extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: String, required: true, maxlength: 128 })
  eventId!: string;

  @Prop({ type: String, default: null, maxlength: 100 })
  callback?: string | null;

  handledAt!: Date;
}

export const WorkyIdempotencyRecordSchema = SchemaFactory.createForClass(WorkyIdempotencyRecord);

WorkyIdempotencyRecordSchema.index({ streamId: 1, eventId: 1 }, { unique: true });

WorkyIdempotencyRecordSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
