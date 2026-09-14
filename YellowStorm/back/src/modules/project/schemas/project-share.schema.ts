import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ProjectShareDocument = HydratedDocument<ProjectShare>;

@Schema({
  timestamps: true,
  collection: 'project-shares',
})
export class ProjectShare extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  projectId!: Types.ObjectId;

  // Denormalized from project.createdBy — enables cleanup without joining projects.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sharedWithUserId!: Types.ObjectId;

  @Prop({ type: String, enum: ['read', 'readwrite'], required: true })
  permission!: 'read' | 'readwrite';

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sharedBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ProjectShareSchema = SchemaFactory.createForClass(ProjectShare);

ProjectShareSchema.index({ projectId: 1, sharedWithUserId: 1 }, { unique: true });
ProjectShareSchema.index({ sharedWithUserId: 1, createdAt: -1 });
ProjectShareSchema.index({ projectId: 1, createdAt: -1 });

ProjectShareSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
