import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type UserAppConnectionDocument = HydratedDocument<UserAppConnection>;

export enum ConnectionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
  ERROR = 'error',
}

@Schema({
  timestamps: true,
  collection: 'user_app_connections',
})
export class UserAppConnection extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  appKey!: string;

  @Prop({ required: true })
  accessToken!: string;

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

  @Prop({
    type: String,
    enum: Object.values(ConnectionStatus),
    default: ConnectionStatus.ACTIVE,
  })
  status!: ConnectionStatus;

  @Prop()
  lastUsedAt?: Date;

  @Prop()
  lastRefreshedAt?: Date;

  @Prop()
  errorMessage?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UserAppConnectionSchema = SchemaFactory.createForClass(UserAppConnection);

UserAppConnectionSchema.index({ userId: 1, appKey: 1 }, { unique: true });

UserAppConnectionSchema.set('toJSON', {
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
