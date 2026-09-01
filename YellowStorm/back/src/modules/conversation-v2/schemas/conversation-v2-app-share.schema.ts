import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ConversationV2AppShareDocument = HydratedDocument<ConversationV2AppShare>;

/**
 * Grants Marketplace access to a deployed app. When `includeConversation` is
 * true, the recipient may also open the conversation with full session access.
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

  /** Set when the recipient already has an account. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: false, default: null, index: true })
  recipientUserId!: Types.ObjectId | null;

  /** Set for invitees who do not have an account yet; claimed on first access. */
  @Prop({ type: String, required: false, default: null, index: true })
  recipientEmail!: string | null;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, required: true })
  deployedUrl!: string;

  @Prop({ type: Date, default: null })
  lastDeployedAt!: Date | null;

  /** When true (default), recipient can open the conversation with full access. */
  @Prop({ type: Boolean, default: true })
  includeConversation!: boolean;

  /** SHA-256 of the opaque register-invite token. Never store the raw token. */
  @Prop({ type: String, required: false, default: null })
  inviteTokenHash!: string | null;

  @Prop({ type: Date, required: false, default: null })
  inviteExpiresAt!: Date | null;

  @Prop({ type: Date, required: false, default: null })
  inviteConsumedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConversationV2AppShareSchema =
  SchemaFactory.createForClass(ConversationV2AppShare);

ConversationV2AppShareSchema.index(
  { sessionId: 1, recipientUserId: 1 },
  {
    unique: true,
    partialFilterExpression: { recipientUserId: { $type: 'objectId' } },
  },
);
ConversationV2AppShareSchema.index(
  { sessionId: 1, recipientEmail: 1 },
  {
    unique: true,
    partialFilterExpression: { recipientEmail: { $type: 'string' } },
  },
);
ConversationV2AppShareSchema.index({ recipientUserId: 1, updatedAt: -1 });
ConversationV2AppShareSchema.index(
  { inviteTokenHash: 1 },
  {
    unique: true,
    partialFilterExpression: { inviteTokenHash: { $type: 'string' } },
  },
);
