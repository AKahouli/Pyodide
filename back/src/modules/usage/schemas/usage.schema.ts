import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type UsageDocument = HydratedDocument<Usage>;

/**
 * Usage record type for categorizing usage
 */
export enum UsageType {
  CHAT = 'chat',
  COMPLETION = 'completion',
  EMBEDDING = 'embedding',
  PLAYBOOK = 'playbook',
  OTHER = 'other',
}

/**
 * Usage Schema
 * Tracks token consumption per user per time window
 * Designed for efficient aggregation and querying
 */
@Schema({
  timestamps: true,
  collection: 'usage',
})
export class Usage extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /**
   * Start of the usage tracking window
   */
  @Prop({ required: true, type: Date, index: true })
  windowStart!: Date;

  /**
   * End of the usage tracking window
   */
  @Prop({ required: true, type: Date, index: true })
  windowEnd!: Date;

  /**
   * Window duration in hours (copied from plan for reference)
   */
  @Prop({ required: true, type: Number })
  windowHours!: number;

  /**
   * Input tokens consumed in this window
   */
  @Prop({ required: true, type: Number, default: 0, min: 0 })
  inputTokens!: number;

  /**
   * Output tokens consumed in this window
   */
  @Prop({ required: true, type: Number, default: 0, min: 0 })
  outputTokens!: number;

  /**
   * Total tokens (input + output) - denormalized for quick access
   */
  @Prop({ required: true, type: Number, default: 0, min: 0 })
  totalTokens!: number;

  /**
   * Number of requests made in this window
   */
  @Prop({ required: true, type: Number, default: 0, min: 0 })
  requestCount!: number;

  /**
   * Plan ID at the time of usage (for historical tracking)
   */
  @Prop({ type: Types.ObjectId, ref: 'Plan' })
  planId?: Types.ObjectId;

  /**
   * Plan slug at the time of usage (denormalized for queries)
   */
  @Prop({ type: String })
  planSlug?: string;

  /**
   * Token limit at the time of window creation
   * Useful for historical reporting
   */
  @Prop({ type: Number })
  tokenLimitAtCreation?: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UsageSchema = SchemaFactory.createForClass(Usage);

// Compound index for finding current usage window efficiently
UsageSchema.index({ userId: 1, windowStart: 1, windowEnd: 1 }, { unique: true });

// Index for querying usage by time range
UsageSchema.index({ userId: 1, windowEnd: -1 });

// Index for analytics queries
UsageSchema.index({ windowStart: 1, planSlug: 1 });

// TTL index to automatically clean up old usage records (optional - 90 days)
// Uncomment if you want automatic cleanup:
// UsageSchema.index({ windowEnd: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
