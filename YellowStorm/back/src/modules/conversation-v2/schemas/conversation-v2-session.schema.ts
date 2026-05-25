import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type ConversationV2SessionDocument = HydratedDocument<ConversationV2Session>;

export type ConversationV2SessionStatus =
  | 'active'
  | 'waiting'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error';

@Schema({ timestamps: true, collection: 'conversation_v2_sessions' })
export class ConversationV2Session extends Document {
  @Prop({ required: true })
  ownerId!: string;

  @Prop({ required: true, unique: true })
  sessionId!: string;

  @Prop({ default: '' })
  title!: string;

  @Prop({
    type: String,
    enum: ['active', 'waiting', 'paused', 'stopped', 'completed', 'error'],
    default: 'active',
  })
  status!: ConversationV2SessionStatus;

  @Prop({ type: Date, default: () => new Date() })
  lastEventAt!: Date;

  @Prop({ default: false })
  isShared!: boolean;

  @Prop({ type: String, default: null, index: true, sparse: true })
  shareTokenHash!: string | null;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;
}

export const ConversationV2SessionSchema =
  SchemaFactory.createForClass(ConversationV2Session);

ConversationV2SessionSchema.index({ ownerId: 1, deletedAt: 1, lastEventAt: -1 });

ConversationV2SessionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.shareTokenHash;
    return ret;
  },
});
