import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ConnectorCredentialDocument = HydratedDocument<ConnectorCredential>;

export enum ConnectorCredentialStatus {
  ACTIVE = 'active',
  INVALID = 'invalid',
  EXPIRED = 'expired',
}

@Schema({
  timestamps: true,
  collection: 'connector_credentials',
})
export class ConnectorCredential extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Connector', index: true })
  connectorId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 128 })
  displayName!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  authPayload!: Record<string, unknown>;

  @Prop({ required: true, enum: ConnectorCredentialStatus, default: ConnectorCredentialStatus.ACTIVE })
  status!: ConnectorCredentialStatus;

  @Prop({ type: Date, default: null })
  lastValidatedAt!: Date | null;

  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConnectorCredentialSchema = SchemaFactory.createForClass(ConnectorCredential);

ConnectorCredentialSchema.index({ connectorId: 1, userId: 1 });
ConnectorCredentialSchema.index({ userId: 1, status: 1 });

ConnectorCredentialSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.authPayload;
    return ret;
  },
});
