import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SkillDocument = HydratedDocument<Skill>;

export enum SkillFileKind {
  REFERENCE = 'reference',
  ASSET = 'asset',
}

@Schema({ _id: true })
export class SkillFile {
  @Prop({ required: true, trim: true, maxlength: 255 })
  path!: string;

  @Prop({ required: true, enum: SkillFileKind })
  kind!: SkillFileKind;

  @Prop({ default: '', maxlength: 255 })
  mimeType!: string;

  @Prop({ default: '', maxlength: 500000 })
  content!: string;
}

export const SkillFileSchema = SchemaFactory.createForClass(SkillFile);

@Schema({
  timestamps: true,
  collection: 'skills',
})
export class Skill extends Document {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 64, index: true })
  name!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 1024 })
  description!: string;

  @Prop({ default: '', maxlength: 64 })
  icon!: string;

  @Prop({ default: '', maxlength: 64 })
  color!: string;

  @Prop({ default: 'light', enum: ['light', 'dark'] })
  iconColor!: 'light' | 'dark';

  @Prop({ type: Types.ObjectId, ref: 'SkillCategory', default: null, index: true })
  categoryId?: Types.ObjectId | null;

  @Prop({ default: '', maxlength: 255 })
  license!: string;

  @Prop({ default: '', maxlength: 500 })
  compatibility!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata!: Record<string, string>;

  @Prop({ type: [String], default: [] })
  allowedTools!: string[];

  @Prop({ default: '', maxlength: 50000 })
  instructions!: string;

  @Prop({ type: [SkillFileSchema], default: [] })
  files!: SkillFile[];

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const SkillSchema = SchemaFactory.createForClass(Skill);

SkillSchema.index({ name: 1, createdBy: 1 }, { unique: true });
SkillSchema.index({ isActive: 1, createdBy: 1 });

SkillSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
