import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type PlaybookPromptTemplateDocument = HydratedDocument<PlaybookPromptTemplate>;

@Schema({ timestamps: true, collection: 'playbook_prompt_templates' })
export class PlaybookPromptTemplate extends Document {
  @Prop({ required: true, unique: true, index: true, trim: true, maxlength: 120 })
  key!: string;

  @Prop({ required: true, trim: true, maxlength: 160 })
  title!: string;

  @Prop({ required: true, trim: true, maxlength: 80, index: true })
  category!: string;

  @Prop({ trim: true, maxlength: 600 })
  description?: string;

  @Prop({ type: String, default: '' })
  systemTemplate!: string;

  @Prop({ type: String, default: '' })
  userTemplate!: string;

  @Prop({ type: Boolean, default: true, index: true })
  enabled!: boolean;

  @Prop({ type: Number, default: 1, min: 1 })
  version!: number;

  @Prop({ type: Boolean, default: true })
  isBuiltIn!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy!: Types.ObjectId | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PlaybookPromptTemplateSchema = SchemaFactory.createForClass(PlaybookPromptTemplate);

PlaybookPromptTemplateSchema.index({ category: 1, enabled: 1 });

PlaybookPromptTemplateSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
