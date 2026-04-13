import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ProviderLinkTokenDocument = HydratedDocument<ProviderLinkToken>;

@Schema({
  timestamps: true,
  collection: 'provider_link_tokens',
})
export class ProviderLinkToken extends Document {
  @Prop({ required: true, unique: true, index: true })
  token!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  providerKey!: string;

  @Prop({ required: true })
  providerUserId!: string;

  @Prop({ required: true, lowercase: true })
  providerEmail!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  // Timestamps (auto-generated)
  createdAt!: Date;
  updatedAt!: Date;
}

export const ProviderLinkTokenSchema = SchemaFactory.createForClass(ProviderLinkToken);

// TTL index — auto-delete expired tokens
ProviderLinkTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
