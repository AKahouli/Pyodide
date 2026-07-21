import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WidgetSessionDocument = HydratedDocument<WidgetSession>;

@Schema({
  timestamps: true,
  collection: 'widget_sessions',
})
export class WidgetSession extends Document {
  @Prop({ required: true, index: true })
  tokenHash!: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Agent', index: true })
  agentId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  visitorId!: string;

  @Prop({ type: Object, default: {} })
  metadata!: { ip?: string; userAgent?: string; origin?: string };

  @Prop({ type: Object, default: {} })
  clientContext!: {
    pageUrl?: string;
    origin?: string;
    referrer?: string;
    locale?: string;
    timezone?: string;
  };

  @Prop({ type: Object, default: {} })
  appSource!: {
    channel: 'web_widget' | 'rest_api';
    appSourceName: string;
    sourceInstanceId?: string;
    origin?: string;
    pageUrl?: string;
  };

  @Prop({ type: Object, default: { status: 'unavailable', reason: 'provider_not_configured' } })
  geo!: { status: 'resolved' | 'unavailable' | 'error'; reason?: string };

  @Prop({ enum: ['active', 'closed'], default: 'active' })
  status!: string;

  @Prop({ default: 0 })
  messageCount!: number;
}

export const WidgetSessionSchema = SchemaFactory.createForClass(WidgetSession);

WidgetSessionSchema.index({ tokenHash: 1, visitorId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });

WidgetSessionSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
