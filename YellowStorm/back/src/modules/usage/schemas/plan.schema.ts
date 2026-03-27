import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type PlanDocument = HydratedDocument<Plan>;

/**
 * Plan tier enum for type safety
 */
export enum PlanTier {
  FREE = 'free',
  BASIC = 'basic',
  ENTERPRISE = 'enterprise',
  UNLIMITED = 'unlimited',
}

/**
 * Plan Schema
 * Stores plan configurations with token limits and time windows
 * Plans are stored in DB for easy management (add/edit/delete)
 */
@Schema({
  timestamps: true,
  collection: 'plans',
})
export class Plan extends Document {
  @Prop({ required: true, unique: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, maxlength: 50 })
  slug!: string;

  @Prop({ type: String, maxlength: 500 })
  description?: string;

  /**
   * Token limit per window
   * -1 means unlimited
   */
  @Prop({ required: true, type: Number, default: 0 })
  tokenLimit!: number;

  /**
   * Time window in hours for token limit reset
   * e.g., 24 = daily limit, 1 = hourly limit
   */
  @Prop({ required: true, type: Number, default: 24, min: 1 })
  windowHours!: number;

  /**
   * Requests per minute limit (rate limiting)
   * -1 means unlimited
   */
  @Prop({ type: Number, default: 60 })
  requestsPerMinute!: number;

  /**
   * Maximum tokens per single request
   * -1 means unlimited
   */
  @Prop({ type: Number, default: -1 })
  maxTokensPerRequest!: number;

  /**
   * Feature flags for this plan
   * Allows granular feature access control
   */
  @Prop({ type: [String], default: [] })
  features!: string[];

  /**
   * Plan priority for upgrades/downgrades
   * Higher number = higher tier
   */
  @Prop({ required: true, type: Number, default: 0 })
  priority!: number;

  /**
   * Price information (for display purposes)
   */
  @Prop({ type: Number, default: 0 })
  priceMonthly!: number;

  @Prop({ type: Number, default: 0 })
  priceYearly!: number;

  @Prop({ type: String, default: 'USD', maxlength: 3 })
  currency!: string;

  /**
   * Whether this plan is currently available for new users
   */
  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  /**
   * Whether this is the default plan for new users
   */
  @Prop({ type: Boolean, default: false })
  isDefault!: boolean;

  /**
   * Display order for UI
   */
  @Prop({ type: Number, default: 0 })
  displayOrder!: number;

  /**
   * Maximum number of workspaces allowed for this plan
   * -1 means unlimited
   */
  @Prop({ type: Number, default: 3 })
  maxWorkspaces!: number;

  /**
   * Storage allocation per workspace in bytes
   * Default: 100MB (100 * 1024 * 1024)
   */
  @Prop({ type: Number, default: 104857600 })
  workspaceStorageBytes!: number;

  /**
   * Metadata for extensibility
   */
  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);

// Indexes for efficient queries
PlanSchema.index({ slug: 1 }, { unique: true });
PlanSchema.index({ isActive: 1, displayOrder: 1 });
PlanSchema.index({ isDefault: 1 });
PlanSchema.index({ priority: 1 });
