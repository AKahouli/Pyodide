import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { WhatsAppIntegrationStatus } from '@modules/whatsapp/schemas/agent-whatsapp-integration.schema';

export type WorkyWhatsAppIntegrationDocument = HydratedDocument<WorkyWhatsAppIntegration>;

@Schema({
  timestamps: true,
  collection: 'worky_whatsapp_integrations',
})
export class WorkyWhatsAppIntegration extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

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

  /** JID of the WhatsApp group used to bridge messages into Worky (e.g. 120363xxx@g.us). */
  @Prop({ trim: true })
  workyGroupJid?: string;

  /** WhatsApp JID of the paired user account (e.g. 216...@s.whatsapp.net). */
  @Prop({ trim: true })
  userWhatsappJid?: string;

  @Prop({ default: true })
  enabled!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyWhatsAppIntegrationSchema =
  SchemaFactory.createForClass(WorkyWhatsAppIntegration);

WorkyWhatsAppIntegrationSchema.index({ streamId: 1 }, { unique: true });
WorkyWhatsAppIntegrationSchema.index({ userId: 1, status: 1 });
