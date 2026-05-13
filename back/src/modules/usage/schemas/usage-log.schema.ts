import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { UsageType } from './usage.schema';

export type UsageLogDocument = HydratedDocument<UsageLog>;

/**
 * UsageLog Schema
 * Detailed per-request logging for analytics and debugging
 * Stored separately from aggregated Usage for performance
 */
@Schema({
  timestamps: true,
  collection: 'usage_logs',
})
export class UsageLog extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /**
   * Type of usage
   */
  @Prop({ type: String, enum: Object.values(UsageType), default: UsageType.CHAT })
  usageType!: UsageType;

  /**
   * Model used for this request (renamed from 'model' to avoid Document conflict)
   */
  @Prop({ type: String, maxlength: 100 })
  modelName?: string;

  /**
   * Input tokens for this request
   */
  @Prop({ required: true, type: Number, min: 0 })
  inputTokens!: number;

  /**
   * Output tokens for this request
   */
  @Prop({ required: true, type: Number, min: 0 })
  outputTokens!: number;

  /**
   * Total tokens for this request
   */
  @Prop({ required: true, type: Number, min: 0 })
  totalTokens!: number;

  /**
   * Request duration in milliseconds
   */
  @Prop({ type: Number, min: 0 })
  durationMs?: number;

  /**
   * Reference to conversation/session if applicable
   */
  @Prop({ type: Types.ObjectId })
  conversationId?: Types.ObjectId;

  /**
   * Request endpoint or action identifier
   */
  @Prop({ type: String, maxlength: 200 })
  endpoint?: string;

  /**
   * IP address of the request
   */
  @Prop({ type: String, maxlength: 45 })
  ipAddress?: string;

  /**
   * User agent of the request
   */
  @Prop({ type: String, maxlength: 500 })
  userAgent?: string;

  /**
   * Whether the request was successful
   */
  @Prop({ type: Boolean, default: true })
  success!: boolean;

  /**
   * Error code if request failed
   */
  @Prop({ type: String, maxlength: 50 })
  errorCode?: string;

  /**
   * Additional metadata
   */
  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UsageLogSchema = SchemaFactory.createForClass(UsageLog);

// Index for user's recent logs
UsageLogSchema.index({ userId: 1, createdAt: -1 });

// Index for analytics by type and model
UsageLogSchema.index({ usageType: 1, modelName: 1, createdAt: -1 });

// Index for analytics by date
UsageLogSchema.index({ createdAt: -1 });

// TTL index to automatically clean up old logs (30 days)
UsageLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
