import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ConversationV2AppShareDocument = HydratedDocument<ConversationV2AppShare>;

/**
 * Grants Marketplace access to a deployed app. When `includeConversation` is
 * true, the recipient may also open the conversation read-only.
 */
@Schema({
  timestamps: true,
  collection: 'conversation_v2_app_shares',
})
export class ConversationV2AppShare extends Document {
  @Prop({ type: Types.ObjectId, ref: 'ConversationV2Session', required: true, index: true })
  sessionId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  recipientUserId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, required: true })
  deployedUrl!: string;

  @Prop({ type: Date, default: null })
  lastDeployedAt!: Date | null;

  /** When true, recipient can GET session + events (read-only). */
  @Prop({ type: Boolean, default: false })
  includeConversation!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConversationV2AppShareSchema =
  SchemaFactory.createForClass(ConversationV2AppShare);

ConversationV2AppShareSchema.index(
  { sessionId: 1, recipientUserId: 1 },
  { unique: true },
);
ConversationV2AppShareSchema.index({ recipientUserId: 1, updatedAt: -1 });
