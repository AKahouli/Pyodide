import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyMessageDocument = HydratedDocument<WorkyMessage>;

/**
 * A single prompt-bar turn between the stream owner and the Manager agent.
 * Persisted by `worky-message.service.ts` (Part 2). Part 1 only declares the
 * shape and the indexes so the Kanban projection in Part 2 can read it.
 */
@Schema({
  timestamps: true,
  collection: 'worky_messages',
})
export class WorkyMessage extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  /** The manager's Postgres `messages.id` (Electric source). Idempotent upsert key; null for non-manager messages. */
  @Prop({ type: String, default: null })
  externalId?: string | null;

  @Prop({
    type: String,
    enum: ['owner', 'manager', 'system'],
    required: true,
  })
  role!: string;

  @Prop({ type: String, required: true, maxlength: 50000 })
  content!: string;

  @Prop({ type: Types.ObjectId, ref: 'WorkyPlanDelta', default: null })
  planDeltaRef?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  emittedAt?: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyMessageSchema = SchemaFactory.createForClass(WorkyMessage);

WorkyMessageSchema.index({ streamId: 1, createdAt: 1 });

WorkyMessageSchema.index(
  { streamId: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
);

WorkyMessageSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
