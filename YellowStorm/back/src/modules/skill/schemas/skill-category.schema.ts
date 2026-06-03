import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type SkillCategoryDocument = HydratedDocument<SkillCategory>;

@Schema({
  timestamps: true,
  collection: 'skill_categories',
})
export class SkillCategory extends Document {
  @Prop({ required: true, unique: true, trim: true, minlength: 1, maxlength: 128, index: true })
  name!: string;

  @Prop({ default: '', maxlength: 1024 })
  description!: string;

  /** Reserved built-in category that cannot be edited or deleted. Skills in it are hidden from users. */
  @Prop({ default: false })
  isSystem!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const SkillCategorySchema = SchemaFactory.createForClass(SkillCategory);

SkillCategorySchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
