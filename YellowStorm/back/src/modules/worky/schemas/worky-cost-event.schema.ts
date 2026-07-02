import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyCostEventDocument = HydratedDocument<WorkyCostEvent>;

/**
 * One cost event per LLM/tool call bridged from the runtime's
 * AutoTracingPlugin. Aggregated into the stream/task budget by
 * `worky-budget.service.ts` (Part 4).
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'worky_cost_events',
})
export class WorkyCostEvent extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkyTask', default: null, index: true })
  taskId?: Types.ObjectId | null;

  @Prop({ type: String, enum: ['llm', 'tool', 'embedding'], required: true })
  type!: string;

  @Prop({ type: String, required: true, maxlength: 100 })
  provider!: string;

  @Prop({ type: String, required: true, maxlength: 200 })
  modelId!: string;

  @Prop({ type: Number, default: 0, min: 0 })
  inputTokens!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  outputTokens!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  costUsd!: number;

  createdAt!: Date;
}

export const WorkyCostEventSchema = SchemaFactory.createForClass(WorkyCostEvent);

WorkyCostEventSchema.index({ streamId: 1, createdAt: 1 });

WorkyCostEventSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
