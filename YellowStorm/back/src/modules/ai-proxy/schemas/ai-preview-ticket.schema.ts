import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AiPreviewTicketDocument = HydratedDocument<AiPreviewTicket>;

/**
 * Multi-use opaque credential for NodePod AI preview relay.
 * Issued to BrowserRuntimeHost (parent); never stored in the generated app.
 * Only the SHA-256 hash is persisted.
 */
@Schema({ timestamps: true, collection: 'ai_preview_tickets' })
export class AiPreviewTicket {
  /** SHA-256 of the plaintext ticket (`aiprev_…`). */
  @Prop({ type: String, required: true, unique: true })
  ticketHash!: string;

  @Prop({ type: String, required: true, index: true })
  conversationSessionId!: string;

  @Prop({ type: String, required: true, index: true })
  workspaceId!: string;

  @Prop({ type: String, required: true, index: true })
  bindingId!: string;

  /** YellowStorm user billed for preview AI usage (session owner). */
  @Prop({ type: String, required: true, index: true })
  billableUserId!: string;

  @Prop({ type: String, required: true, default: 'ai_preview' })
  purpose!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AiPreviewTicketSchema = SchemaFactory.createForClass(AiPreviewTicket);

AiPreviewTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
