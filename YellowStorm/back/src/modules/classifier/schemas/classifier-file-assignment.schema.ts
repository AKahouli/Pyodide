import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ClassifierFileAssignmentDocument = HydratedDocument<ClassifierFileAssignment>;

export enum AssignmentSource {
  MANUAL = 'manual',
  PLAYBOOK = 'playbook',
}

@Schema({
  timestamps: true,
  collection: 'classifier_file_assignments',
})
export class ClassifierFileAssignment extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkspaceDoc', required: true })
  documentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ClassifierFolder', default: null, index: true })
  folderId!: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: AssignmentSource,
    default: AssignmentSource.MANUAL,
  })
  assignmentSource!: AssignmentSource;

  @Prop({ type: Types.ObjectId, ref: 'ClassificationRun', default: null })
  classificationRunId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  assignedBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ClassifierFileAssignmentSchema = SchemaFactory.createForClass(ClassifierFileAssignment);

ClassifierFileAssignmentSchema.index(
  { workspaceId: 1, documentId: 1 },
  { unique: true },
);
ClassifierFileAssignmentSchema.index({ workspaceId: 1, folderId: 1 });

ClassifierFileAssignmentSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
