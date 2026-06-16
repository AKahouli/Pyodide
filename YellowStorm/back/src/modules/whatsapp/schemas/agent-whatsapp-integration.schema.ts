import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type AgentWhatsAppIntegrationDocument = HydratedDocument<AgentWhatsAppIntegration>;

export enum WhatsAppIntegrationStatus {
  PAIRING = 'PAIRING',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  FAILED = 'FAILED',
}

@Schema({
  timestamps: true,
  collection: 'agent_whatsapp_integrations',
})
export class AgentWhatsAppIntegration extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Agent', required: true })
  agentId!: Types.ObjectId;

  @Prop({ trim: true })
  phoneNumber?: string;

  @Prop({ trim: true, maxlength: 200 })
  displayName?: string;

  @Prop({
    type: String,
    enum: WhatsAppIntegrationStatus,
    default: WhatsAppIntegrationStatus.DISCONNECTED,
    index: true,
  })
  status!: WhatsAppIntegrationStatus;

  @Prop({ trim: true, index: true })
  sessionId?: string;

  @Prop()
  lastActivityAt?: Date;

  @Prop({ maxlength: 500 })
  errorMessage?: string;

  @Prop({ default: true })
  enabled!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AgentWhatsAppIntegrationSchema =
  SchemaFactory.createForClass(AgentWhatsAppIntegration);

AgentWhatsAppIntegrationSchema.index({ agentId: 1 }, { unique: true });
AgentWhatsAppIntegrationSchema.index({ userId: 1, status: 1 });
