import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyEphemeralWorkerDocument = HydratedDocument<WorkyEphemeralWorker>;

/**
 * Per-task ephemeral AI worker spawned by the Manager. The runtime maps
 * this record to a short-lived `LlmAgent` (Part 3) bound to the task's
 * toolset.
 */
@Schema({
  timestamps: true,
  collection: 'worky_ephemeral_workers',
})
export class WorkyEphemeralWorker extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkyTask', required: true, index: true })
  taskId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Agent', required: true })
  agentEntityId!: Types.ObjectId;

  @Prop({ type: String, required: true, maxlength: 100 })
  role!: string;

  @Prop({
    type: String,
    enum: ['spawned', 'running', 'done', 'failed', 'canceled'],
    required: true,
    default: 'spawned',
  })
  status!: string;

  @Prop({ type: String, default: null })
  adkSessionId?: string | null;

  @Prop({ type: String, default: null })
  adkInvocationId?: string | null;

  @Prop({ type: Date, default: null })
  lastCheckpointAt?: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyEphemeralWorkerSchema = SchemaFactory.createForClass(WorkyEphemeralWorker);

WorkyEphemeralWorkerSchema.index({ streamId: 1, status: 1 });
WorkyEphemeralWorkerSchema.index({ taskId: 1, createdAt: -1 });

WorkyEphemeralWorkerSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
