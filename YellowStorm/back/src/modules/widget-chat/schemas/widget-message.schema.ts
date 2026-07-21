import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WidgetMessageDocument = HydratedDocument<WidgetMessage>;

@Schema({
  timestamps: true,
  collection: 'widget_messages',
})
export class WidgetMessage extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'WidgetSession', index: true })
  sessionId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  tokenHash!: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Agent' })
  agentId!: Types.ObjectId;

  @Prop({ required: true, enum: ['user', 'assistant'] })
  role!: string;

  @Prop({ required: true, maxlength: 50000 })
  content!: string;

  @Prop({ type: [] })
  components?: Array<{ id: string; type: string; data: Record<string, unknown> }>;

  @Prop({ type: Object, default: undefined })
  interaction?: Record<string, unknown>;

  @Prop()
  inputTokens?: number;

  @Prop()
  outputTokens?: number;

  @Prop()
  durationMs?: number;

}

export const WidgetMessageSchema = SchemaFactory.createForClass(WidgetMessage);

WidgetMessageSchema.index({ sessionId: 1, createdAt: 1 });

WidgetMessageSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
