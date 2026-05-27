import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type TelegramLinkCodeDocument = HydratedDocument<TelegramLinkCode>;

@Schema({
  timestamps: true,
  collection: 'telegram_link_codes',
})
export class TelegramLinkCode extends Document {
  @Prop({ type: Types.ObjectId, ref: 'AgentTelegramIntegration', required: true, index: true })
  integrationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Agent', required: true, index: true })
  agentId!: Types.ObjectId;

  @Prop({ required: true, unique: true })
  codeHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ default: false })
  consumed!: boolean;

  @Prop()
  consumedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TelegramLinkCodeSchema = SchemaFactory.createForClass(TelegramLinkCode);
TelegramLinkCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
