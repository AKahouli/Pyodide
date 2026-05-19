import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type AdminConnectorAuthDocument = HydratedDocument<AdminConnectorAuth>;

export enum AdminConnectorAuthStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
  ERROR = 'error',
}

@Schema({
  timestamps: true,
  collection: 'admin_connector_auth_tokens',
})
export class AdminConnectorAuth extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 64, index: true })
  appKey!: string;

  @Prop({ required: false })
  accessToken?: string;

  @Prop()
  refreshToken?: string;

  @Prop()
  tokenExpiresAt?: Date;

  @Prop({ type: [String], default: [] })
  scopes!: string[];

  @Prop()
  providerAccountId?: string;

  @Prop()
  providerEmail?: string;

  @Prop({ default: true, index: true })
  connected!: boolean;

  @Prop({
    type: String,
    enum: Object.values(AdminConnectorAuthStatus),
    default: AdminConnectorAuthStatus.ACTIVE,
  })
  status!: AdminConnectorAuthStatus;

  @Prop()
  disconnectedAt?: Date;

  @Prop()
  lastUsedAt?: Date;

  @Prop()
  lastRefreshedAt?: Date;

  @Prop()
  errorMessage?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AdminConnectorAuthSchema = SchemaFactory.createForClass(AdminConnectorAuth);

AdminConnectorAuthSchema.index({ userId: 1, appKey: 1 }, { unique: true });
AdminConnectorAuthSchema.index({ appKey: 1, connected: 1 });

AdminConnectorAuthSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.accessToken;
    delete ret.refreshToken;
    return ret;
  },
});
