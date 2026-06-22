import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyAuditEventDocument = HydratedDocument<WorkyAuditEvent>;

/**
 * Append-only audit row. Every state mutation in the module — including
 * `off` governance evaluations (canonical §5.3) — emits one of these.
 * Never updated, never deleted.
 */
@Schema({
  timestamps: { createdAt: 'occurredAt', updatedAt: false },
  collection: 'worky_audit_events',
})
export class WorkyAuditEvent extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  actorUserId?: Types.ObjectId | null;

  @Prop({ type: String, required: true, maxlength: 100 })
  action!: string;

  @Prop({ type: String, default: null, maxlength: 100 })
  targetType?: string | null;

  @Prop({ type: Types.ObjectId, default: null })
  targetId?: Types.ObjectId | null;

  @Prop({ type: Object, default: {} })
  details!: Record<string, unknown>;

  occurredAt!: Date;
}

export const WorkyAuditEventSchema = SchemaFactory.createForClass(WorkyAuditEvent);

WorkyAuditEventSchema.index({ streamId: 1, occurredAt: -1 });
WorkyAuditEventSchema.index({ action: 1, occurredAt: -1 });

WorkyAuditEventSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
