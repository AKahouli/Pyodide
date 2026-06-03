import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WidgetTokenDocument = HydratedDocument<WidgetToken>;

@Schema({
  timestamps: true,
  collection: 'widget_tokens',
})
export class WidgetToken extends Document {
  @Prop({ required: true, unique: true, index: true })
  tokenHash!: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Agent', index: true })
  agentId!: Types.ObjectId;

  @Prop({ maxlength: 200 })
  label?: string;

  @Prop({ type: [String], default: [] })
  allowedOrigins!: string[];

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ type: Date, index: { sparse: true } })
  expiresAt?: Date;

  @Prop({ type: Date })
  lastUsedAt?: Date;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy!: Types.ObjectId;
}

export const WidgetTokenSchema = SchemaFactory.createForClass(WidgetToken);

WidgetTokenSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.tokenHash;
    return ret;
  },
});
