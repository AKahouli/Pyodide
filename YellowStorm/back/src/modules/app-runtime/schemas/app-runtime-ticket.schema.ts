import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppRuntimeTicketDocument = HydratedDocument<AppRuntimeTicket>;

/**
 * One-shot handshake credential for the `/app-runtime` Socket.IO namespace.
 * Issued over an authenticated Conversation V2 request, consumed exactly once
 * by the gateway. Only the hash is stored, like the MCP token.
 */
@Schema({ timestamps: true, collection: 'app_runtime_tickets' })
export class AppRuntimeTicket {
  @Prop({ type: String, required: true, unique: true })
  runtimeSessionId!: string;

  /** SHA-256 of the ticket. The plaintext is never persisted. */
  @Prop({ type: String, required: true, unique: true })
  ticketHash!: string;

  @Prop({ type: String, required: true, index: true })
  bindingId!: string;

  @Prop({ type: String, required: true, index: true })
  workspaceId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  consumedAt?: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AppRuntimeTicketSchema = SchemaFactory.createForClass(AppRuntimeTicket);

AppRuntimeTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
