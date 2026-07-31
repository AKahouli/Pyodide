import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type AiModelDocument = HydratedDocument<AiModel>;

@Schema({
  timestamps: true,
  collection: 'models',
})
export class AiModel extends Document {
  @Prop({ required: true, unique: true, index: true })
  modelId!: string; // e.g., "gpt-4o"

  @Prop({ required: true })
  name!: string; // e.g., "GPT-4o"

  @Prop({ required: true })
  chef!: string; // e.g., "OpenAI"

  @Prop({ required: true, index: true })
  chefSlug!: string; // e.g., "openai"

  @Prop({ default: '' })
  litellmModel!: string; // Full LiteLLM identifier (e.g., "azure/gpt-4.1", "anthropic/claude-sonnet-4-5")

  @Prop({ type: [String], default: [] })
  providers!: string[]; // e.g., ["azure"]

  @Prop({ default: '', index: true })
  type!: string; // Legacy primary classification; mirrors the first value in types.

  @Prop({ type: [String], default: [], index: true })
  types!: string[]; // Classifications: chat | embedding | image_generation | ...

  @Prop({ default: true })
  isActive!: boolean; // Can disable models

  @Prop({ default: false })
  isDefault!: boolean; // Only one model can be default at a time

  @Prop({ default: false })
  omitTemperature!: boolean; // Do not forward temperature for providers that reject it

  @Prop({ type: [String], enum: ['text', 'image'], default: ['text'] })
  inputModalities!: string[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const AiModelSchema = SchemaFactory.createForClass(AiModel);

// Indexes
AiModelSchema.index({ chefSlug: 1, isActive: 1 });
AiModelSchema.index({ type: 1, isActive: 1 });
AiModelSchema.index({ types: 1, isActive: 1 });
AiModelSchema.index({ isActive: 1 });
AiModelSchema.index({ isDefault: 1 });

// JSON transform
AiModelSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret.modelId;
    delete ret._id;
    delete ret.__v;
    delete ret.modelId;
    return ret;
  },
});
