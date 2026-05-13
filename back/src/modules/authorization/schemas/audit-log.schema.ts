import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'audit_logs',
})
export class AuditLog extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  actorId!: Types.ObjectId;

  @Prop({ required: true })
  actorEmail!: string;

  @Prop({ required: true, index: true })
  action!: string;

  @Prop({ type: Types.ObjectId, index: true })
  targetId?: Types.ObjectId;

  @Prop({ index: true })
  targetType?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop({ required: true, enum: ['success', 'failure'], index: true })
  status!: 'success' | 'failure';

  @Prop()
  failureReason?: string;

  // Timestamp (auto-generated)
  createdAt!: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Compound indexes for common queries
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

// TTL index: automatically delete logs older than 2 years (730 days)
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 730 * 24 * 60 * 60 });

// Ensure virtuals are included in JSON output
AuditLogSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
