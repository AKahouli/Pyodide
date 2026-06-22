import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyTraceDocument = HydratedDocument<WorkyTrace>;

/**
 * Tool/model trace summary bridged from the runtime's AutoTracingPlugin.
 * Raw payloads are referenced by URI (admin-only); the persisted row carries
 * only the summary needed to render the task drawer (Part 4).
 */
@Schema({
  timestamps: true,
  collection: 'worky_traces',
})
export class WorkyTrace extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkyTask', required: true, index: true })
  taskId!: Types.ObjectId;

  @Prop({ type: String, enum: ['tool', 'model'], required: true })
  kind!: string;

  @Prop({ type: String, required: true, maxlength: 200 })
  name!: string;

  @Prop({ type: String, default: '', maxlength: 5000 })
  summary!: string;

  @Prop({ type: String, default: null })
  rawPayloadUri?: string | null;

  @Prop({ type: Number, default: 0, min: 0 })
  durationMs!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyTraceSchema = SchemaFactory.createForClass(WorkyTrace);

WorkyTraceSchema.index({ streamId: 1, taskId: 1, createdAt: 1 });

WorkyTraceSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
