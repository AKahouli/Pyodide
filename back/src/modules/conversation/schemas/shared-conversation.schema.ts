import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type SharedConversationDocument = HydratedDocument<SharedConversation>;

export class EmbeddedMessageSchema {
  @Prop({ type: String, required: true, enum: ['user', 'ai'] })
  conversationType!: string;

  @Prop({ type: String })
  content?: string;

  @Prop({ type: [{ type: { type: String }, data: Object }] })
  components?: Array<{ type: string; data: Record<string, unknown> }>;

  @Prop({ type: String })
  modelId?: string;

  @Prop({ type: Date, required: true })
  createdAt!: Date;
}

@Schema({
  timestamps: true,
  collection: 'shared_conversations',
})
export class SharedConversation extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true, index: true })
  originalConversationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  sharedBy!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['public', 'private'] })
  shareType!: string;

  @Prop({ type: String, trim: true, maxlength: 200 })
  title!: string;

  // For public shares - embedded message snapshot
  @Prop({ type: [{ conversationType: String, content: String, components: [{ type: { type: String }, data: Object }], modelId: String, createdAt: Date }], default: undefined })
  messages?: EmbeddedMessageSchema[];

  // For public shares - access control
  @Prop({ type: String, unique: true, sparse: true, index: true })
  accessToken?: string;

  // For private shares - recipient tracking
  @Prop({ type: [String], default: undefined })
  recipientEmails?: string[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Conversation' }], default: undefined })
  forkedConversationIds?: Types.ObjectId[];

  @Prop({ type: Date })
  expiresAt?: Date;

  @Prop({ type: Number, default: 0 })
  viewCount!: number;

  @Prop({ type: Boolean, default: false })
  isRevoked!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const SharedConversationSchema = SchemaFactory.createForClass(SharedConversation);

// Indexes
SharedConversationSchema.index({ sharedBy: 1, createdAt: -1 });
SharedConversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// JSON transform
SharedConversationSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
