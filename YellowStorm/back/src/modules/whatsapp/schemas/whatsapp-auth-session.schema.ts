import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WhatsAppAuthSessionDocument = HydratedDocument<WhatsAppAuthSession>;

@Schema({
  timestamps: true,
  collection: 'whatsapp_auth_sessions',
})
export class WhatsAppAuthSession extends Document {
  @Prop({ type: Types.ObjectId, ref: 'AgentWhatsAppIntegration', required: true })
  integrationId!: Types.ObjectId;

  @Prop({ required: true })
  encryptedCredentials!: string;

  @Prop({ required: true })
  encryptedKeys!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WhatsAppAuthSessionSchema = SchemaFactory.createForClass(WhatsAppAuthSession);

WhatsAppAuthSessionSchema.index({ integrationId: 1 }, { unique: true });
