import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

@Schema({ _id: false })
export class DeviceInfo {
  @Prop({ required: true })
  userAgent!: string;

  @Prop()
  browser?: string;

  @Prop()
  browserVersion?: string;

  @Prop()
  os?: string;

  @Prop()
  osVersion?: string;

  @Prop()
  device?: string;

  @Prop()
  deviceType?: string;
}

@Schema({
  timestamps: true,
  collection: 'sessions',
})
export class Session extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  refreshTokenHash!: string;

  @Prop({ type: DeviceInfo, required: true })
  deviceInfo!: DeviceInfo;

  @Prop({ required: true })
  ipAddress!: string;

  @Prop({ default: true })
  isValid!: boolean;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop()
  lastActivityAt?: Date;

  // Token family for detecting reuse attacks
  @Prop({ required: true })
  tokenFamily!: string;

  // Timestamps (auto-generated)
  createdAt!: Date;
  updatedAt!: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

// Indexes
SessionSchema.index({ userId: 1, isValid: 1 }); // Composite index for active session queries
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-cleanup
SessionSchema.index({ tokenFamily: 1 }); // Index for token reuse detection queries

// Transform for JSON output
SessionSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.refreshTokenHash;
    delete ret.tokenFamily;
    return ret;
  },
});
