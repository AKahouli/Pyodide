import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type OAuthStateDocument = HydratedDocument<OAuthState>;

@Schema({
  timestamps: true,
  collection: 'oauth_states',
})
export class OAuthState extends Document {
  @Prop({ required: true, unique: true, index: true })
  state!: string;

  @Prop({ required: true })
  providerKey!: string;

  @Prop()
  codeVerifier?: string; // PKCE code_verifier

  @Prop()
  returnUrl?: string;

  @Prop({ required: true })
  expiresAt!: Date;

  // Timestamps (auto-generated)
  createdAt!: Date;
  updatedAt!: Date;
}

export const OAuthStateSchema = SchemaFactory.createForClass(OAuthState);

// TTL index — auto-delete expired states
OAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
