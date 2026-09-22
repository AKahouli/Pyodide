import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type AppBuilderAiOfferDocument = HydratedDocument<AppBuilderAiOffer>;

@Schema({ timestamps: true, collection: 'app_builder_ai_offers' })
export class AppBuilderAiOffer extends Document {
  @Prop({ required: true, unique: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, maxlength: 50 })
  slug!: string;

  @Prop({ type: String, maxlength: 500 })
  description?: string;

  /** Token limit per window; -1 = unlimited */
  @Prop({ required: true, type: Number, default: 0 })
  tokenLimit!: number;

  @Prop({ required: true, type: Number, default: 24, min: 1 })
  windowHours!: number;

  /** -1 = unlimited */
  @Prop({ type: Number, default: 60 })
  requestsPerMinute!: number;

  /** -1 = unlimited */
  @Prop({ type: Number, default: -1 })
  maxTokensPerRequest!: number;

  @Prop({ type: Number, default: 0 })
  priority!: number;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isDefault!: boolean;

  @Prop({ type: Number, default: 0 })
  displayOrder!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AppBuilderAiOfferSchema = SchemaFactory.createForClass(AppBuilderAiOffer);

AppBuilderAiOfferSchema.index({ isActive: 1, displayOrder: 1 });
AppBuilderAiOfferSchema.index({ isDefault: 1 });
