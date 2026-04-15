import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type AuthProviderDocument = HydratedDocument<AuthProvider>;

@Schema({
  timestamps: true,
  collection: 'auth_providers',
})
export class AuthProvider extends Document {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
    maxlength: 50,
  })
  providerKey!: string;

  @Prop({ required: true, trim: true, maxlength: 100 })
  displayName!: string;

  @Prop({ required: true })
  clientId!: string; // Encrypted via CryptoService

  @Prop({ required: true })
  clientSecret!: string; // Encrypted via CryptoService

  @Prop()
  tenantId?: string; // Encrypted via CryptoService (optional, for Azure AD)

  @Prop({ required: true })
  authorizationUrl!: string;

  @Prop({ required: true })
  tokenUrl!: string;

  @Prop({ required: true })
  userinfoUrl!: string;

  @Prop({ type: [String], default: ['openid', 'email', 'profile'] })
  scopes!: string[];

  @Prop({ trim: true, maxlength: 50 })
  iconKey?: string;

  @Prop({ type: Number, default: 0 })
  sortOrder!: number;

  @Prop({ type: Boolean, default: true })
  pkceEnabled!: boolean;

  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  // Timestamps (auto-generated)
  createdAt!: Date;
  updatedAt!: Date;
}

export const AuthProviderSchema = SchemaFactory.createForClass(AuthProvider);

// Indexes
AuthProviderSchema.index({ enabled: 1, sortOrder: 1 });

// Transform for JSON output — mask secrets
AuthProviderSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    if (ret.clientId) ret.clientId = '****';
    if (ret.clientSecret) ret.clientSecret = '****';
    if (ret.tenantId) ret.tenantId = '****';
    return ret;
  },
});
