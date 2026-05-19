import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkspaceShareDocument = HydratedDocument<WorkspaceShare>;

@Schema({
  timestamps: true,
  collection: 'workspace-shares',
})
export class WorkspaceShare extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId!: Types.ObjectId;

  // Denormalized from workspace.createdBy — enables cleanup when an owner is deleted
  // without joining workspaces.
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

export const WorkspaceShareSchema = SchemaFactory.createForClass(WorkspaceShare);

WorkspaceShareSchema.index({ workspaceId: 1, sharedWithUserId: 1 }, { unique: true });
WorkspaceShareSchema.index({ sharedWithUserId: 1, createdAt: -1 });
WorkspaceShareSchema.index({ workspaceId: 1, createdAt: -1 });

WorkspaceShareSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
