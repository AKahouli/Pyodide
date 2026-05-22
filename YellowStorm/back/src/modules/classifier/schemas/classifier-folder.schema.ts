import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ClassifierFolderDocument = HydratedDocument<ClassifierFolder>;

@Schema({
  timestamps: true,
  collection: 'classifier_folders',
})
export class ClassifierFolder extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ClassifierFolder', default: null, index: true })
  parentId!: Types.ObjectId | null;

  @Prop({ type: String, required: true, trim: true, minlength: 1, maxlength: 100 })
  name!: string;

  @Prop({ type: String, required: true, trim: true, minlength: 1, maxlength: 1000 })
  description!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ClassifierFolderSchema = SchemaFactory.createForClass(ClassifierFolder);

ClassifierFolderSchema.index({ workspaceId: 1, parentId: 1, name: 1 }, { unique: true });
ClassifierFolderSchema.index({ workspaceId: 1, createdAt: -1 });

ClassifierFolderSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
