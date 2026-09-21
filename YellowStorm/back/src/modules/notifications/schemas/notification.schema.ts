import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { NotificationPriority, NotificationStatus, NotificationType } from '../notification.types';

export type NotificationDocument = HydratedDocument<Notification>;

// Enums live in ../notification.types.ts (plan 1B.1.1); re-exported here until
// the notifications cutover so in-module imports stay untouched.
export { NotificationPriority, NotificationStatus, NotificationType };

@Schema({ _id: false })
export class NotificationMetadata {
  @Prop({ required: true, maxlength: 100 })
  sourceModule!: string;

  @Prop({
    type: String,
    enum: NotificationPriority,
    default: NotificationPriority.NORMAL,
  })
  priority!: NotificationPriority;

  @Prop()
  expiresAt?: Date;

  @Prop({ type: Object })
  extra?: Record<string, unknown>;
}

@Schema({ _id: false })
export class NotificationAction {
  @Prop({ maxlength: 50 })
  label?: string;

  @Prop({ maxlength: 200 })
  url?: string;

  @Prop({ maxlength: 50 })
  action?: string;
}

@Schema({
  timestamps: true,
  collection: 'notifications',
})
export class Notification extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  @Prop({
    type: String,
    enum: NotificationType,
    required: true,
    index: true,
  })
  type!: NotificationType;

  @Prop({ required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  message!: string;

  @Prop({ type: Object })
  data?: Record<string, unknown>;

  @Prop({ type: [NotificationAction], default: [] })
  actions?: NotificationAction[];

  @Prop({ required: true, default: 'user', index: true })
  destination!: string;

  @Prop({
    type: String,
    enum: NotificationStatus,
    default: NotificationStatus.PENDING,
    index: true,
  })
  status!: NotificationStatus;

  @Prop({ type: NotificationMetadata, required: true })
  metadata!: NotificationMetadata;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop()
  sentAt?: Date;

  @Prop()
  readAt?: Date;

  @Prop({ type: Number, default: 0 })
  retryCount!: number;

  @Prop()
  lastError?: string;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Indexes for common queries
NotificationSchema.index({ userId: 1, status: 1, createdAt: -1 });
NotificationSchema.index({ destination: 1, status: 1 });
NotificationSchema.index({ 'metadata.expiresAt': 1 }, { expireAfterSeconds: 0 });
NotificationSchema.index({ createdAt: -1 });
NotificationSchema.index({ status: 1, retryCount: 1 });

// Transform for JSON output
NotificationSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.retryCount;
    delete ret.lastError;
    return ret;
  },
});
