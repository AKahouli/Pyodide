import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WhatsAppChatBindingDocument = HydratedDocument<WhatsAppChatBinding>;

@Schema({
  timestamps: true,
  collection: 'whatsapp_chat_bindings',
})
export class WhatsAppChatBinding extends Document {
  @Prop({ type: Types.ObjectId, ref: 'AgentWhatsAppIntegration', required: true, index: true })
  integrationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Agent', required: true, index: true })
  agentId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  remoteJid!: string;

  @Prop({ type: Types.ObjectId, ref: 'Conversation' })
  conversationId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkyStream' })
  workyStreamId?: Types.ObjectId;

  @Prop()
  lastMessageAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WhatsAppChatBindingSchema = SchemaFactory.createForClass(WhatsAppChatBinding);

WhatsAppChatBindingSchema.index({ integrationId: 1, remoteJid: 1 }, { unique: true });
