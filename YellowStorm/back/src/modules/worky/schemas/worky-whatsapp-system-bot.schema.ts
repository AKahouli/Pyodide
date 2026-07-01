import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { WhatsAppIntegrationStatus } from '@modules/whatsapp/schemas/agent-whatsapp-integration.schema';

export const WORKY_WHATSAPP_SYSTEM_BOT_KEY = 'singleton';

export type WorkyWhatsAppSystemBotDocument = HydratedDocument<WorkyWhatsAppSystemBot>;

@Schema({
  timestamps: true,
  collection: 'worky_whatsapp_system_bot',
})
export class WorkyWhatsAppSystemBot extends Document {
  @Prop({ type: String, default: WORKY_WHATSAPP_SYSTEM_BOT_KEY, unique: true })
  key!: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  pairedByUserId?: Types.ObjectId;

  @Prop({ trim: true })
  phoneNumber?: string;

  /** Admin-configured digits-only phone that must be used when pairing the system bot. */
  @Prop({ trim: true, maxlength: 20 })
  expectedPairingPhone?: string;

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

export const WorkyWhatsAppSystemBotSchema =
  SchemaFactory.createForClass(WorkyWhatsAppSystemBot);
