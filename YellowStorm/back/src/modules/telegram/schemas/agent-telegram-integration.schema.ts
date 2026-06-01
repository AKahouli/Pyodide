import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type AgentTelegramIntegrationDocument = HydratedDocument<AgentTelegramIntegration>;

export enum TelegramIntegrationStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  ERROR = 'error',
}

@Schema({
  timestamps: true,
  collection: 'agent_telegram_integrations',
})
export class AgentTelegramIntegration extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Agent', required: true })
  agentId!: Types.ObjectId;

  @Prop({ required: true })
  encryptedBotToken!: string;

  @Prop({ trim: true, maxlength: 100 })
  botUsername?: string;

  @Prop({ required: true })
  webhookSecret!: string;

  @Prop({ default: true, index: true })
  enabled!: boolean;

  @Prop({
    type: String,
    enum: TelegramIntegrationStatus,
    default: TelegramIntegrationStatus.PENDING,
    index: true,
  })
  status!: TelegramIntegrationStatus;

  @Prop({ maxlength: 500 })
  errorMessage?: string;

  @Prop()
  lastWebhookAt?: Date;

  @Prop()
  lastUpdateId?: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AgentTelegramIntegrationSchema =
  SchemaFactory.createForClass(AgentTelegramIntegration);

AgentTelegramIntegrationSchema.index({ agentId: 1 }, { unique: true });
AgentTelegramIntegrationSchema.index({ userId: 1, enabled: 1 });
