import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type TelegramChatBindingDocument = HydratedDocument<TelegramChatBinding>;

@Schema({
  timestamps: true,
  collection: 'telegram_chat_bindings',
})
export class TelegramChatBinding extends Document {
  @Prop({ type: Types.ObjectId, ref: 'AgentTelegramIntegration', required: true, index: true })
  integrationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Agent', required: true, index: true })
  agentId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  telegramChatId!: string;

  @Prop({ trim: true })
  telegramUserId?: string;

  @Prop({ type: Types.ObjectId, ref: 'Conversation' })
  conversationId?: Types.ObjectId;

  @Prop()
  lastMessageAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TelegramChatBindingSchema =
  SchemaFactory.createForClass(TelegramChatBinding);

TelegramChatBindingSchema.index(
  { integrationId: 1, telegramChatId: 1 },
  { unique: true },
);
