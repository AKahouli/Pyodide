import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlaybookAssistantMessageDocument = HydratedDocument<PlaybookAssistantMessage>;

@Schema({ timestamps: true })
export class PlaybookAssistantMessage {
  @Prop({ required: true, type: String, unique: true, index: true })
  messageId!: string;

  @Prop({ required: true, type: String, index: true })
  requestId!: string;

  @Prop({ required: true, type: String, index: true })
  conversationId!: string;

  @Prop({ required: true, type: String, index: true })
  ownerId!: string;

  @Prop({ required: true, type: String, index: true })
  playbookId!: string;

  @Prop({ required: true, type: String, enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';

  @Prop({ required: true, type: String })
  content!: string;

  @Prop({ required: false, type: String, default: null })
  operationId?: string | null;

  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  createdAt?: Date;
}

export const PlaybookAssistantMessageSchema = SchemaFactory.createForClass(PlaybookAssistantMessage);
PlaybookAssistantMessageSchema.index({ requestId: 1, role: 1 }, { unique: true });
PlaybookAssistantMessageSchema.index({ ownerId: 1, conversationId: 1, createdAt: 1 });
PlaybookAssistantMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
