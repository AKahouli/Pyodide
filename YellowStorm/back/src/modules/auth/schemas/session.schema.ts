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

  // --- Atomic refresh rotation bookkeeping ---
  // Set on the SUCCESSOR: each predecessor can produce at most one successor
  // (enforced by the unique sparse index below).
  @Prop({ type: Types.ObjectId })
  rotatedFromSessionId?: Types.ObjectId;

  // Set on the PREDECESSOR when it is rotated away.
  @Prop({ type: Types.ObjectId })
  rotatedToSessionId?: Types.ObjectId;

  // Client-supplied idempotency identity for one logical rotation.
  @Prop()
  rotationAttemptId?: string;

  @Prop()
  rotatedAt?: Date;

  // Bounded lost-response receipt: encrypts the successor refresh secret so
  // the SAME rotation attempt can recover it inside the window. Never store
  // plaintext; never extend the expiry on replay.
  @Prop()
  rotationReceiptExpiresAt?: Date;

  @Prop()
  rotationReceiptCiphertext?: string;

  @Prop()
  rotationReceiptKeyId?: string;

  // Timestamps (auto-generated)
  createdAt!: Date;
  updatedAt!: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

// Indexes
SessionSchema.index({ userId: 1, isValid: 1 }); // Composite index for active session queries
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-cleanup
SessionSchema.index({ tokenFamily: 1 }); // Index for token reuse detection queries
SessionSchema.index({ rotatedFromSessionId: 1 }, { unique: true, sparse: true }); // One successor per predecessor

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
    // Rotation bookkeeping is internal; receipt material must never serialize.
    delete ret.rotatedFromSessionId;
    delete ret.rotatedToSessionId;
    delete ret.rotationAttemptId;
    delete ret.rotatedAt;
    delete ret.rotationReceiptExpiresAt;
    delete ret.rotationReceiptCiphertext;
    delete ret.rotationReceiptKeyId;
    return ret;
  },
});
