import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlowTaskResultDocument = HydratedDocument<FlowTaskResult>;

@Schema({ timestamps: true })
export class FlowTaskResult {
  @Prop({ required: true, type: String })
  executionId!: string;

  @Prop({ required: true, type: String })
  taskId!: string;

  @Prop({ required: true, type: Number, default: 0 })
  iteration!: number;

  @Prop({ required: true, type: String, enum: ['pending', 'running', 'completed', 'failed', 'skipped'], default: 'pending' })
  status!: string;

  @Prop({ required: false, type: Object })
  output?: unknown;

  @Prop({ required: false, type: String })
  error?: string;

  @Prop({ required: false, type: Date })
  startedAt?: Date;

  @Prop({ required: false, type: Date })
  endedAt?: Date;
}

export const FlowTaskResultSchema = SchemaFactory.createForClass(FlowTaskResult);

FlowTaskResultSchema.index({ executionId: 1, taskId: 1, iteration: 1 }, { unique: true });
FlowTaskResultSchema.index({ executionId: 1, taskId: 1 });

FlowTaskResultSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
