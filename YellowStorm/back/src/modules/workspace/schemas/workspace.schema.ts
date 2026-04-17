import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkspaceDocument = HydratedDocument<Workspace>;

@Schema({
  timestamps: true,
  collection: 'workspaces',
})
export class Workspace extends Document {
  @Prop({ required: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({ required: true, trim: true, lowercase: true, maxlength: 100 })
  alias!: string;

  @Prop({ trim: true, maxlength: 500 })
  description?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkspaceSetting', index: true })
  settings?: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0 })
  documentCount!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  usedStorage!: number;

  @Prop({ type: Number, required: true, min: 0 })
  allocatedStorage!: number;

  @Prop({ type: Boolean, default: false, index: true })
  isSystem!: boolean;

  @Prop({ type: Boolean, default: false, index: true })
  isPersonal!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Conversation' })
  conversationId?: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkspaceSchema = SchemaFactory.createForClass(Workspace);

// Compound indexes
WorkspaceSchema.index({ createdBy: 1, name: 1 }, { unique: true });
WorkspaceSchema.index({ createdBy: 1, alias: 1 }, { unique: true });
WorkspaceSchema.index({ createdBy: 1, createdAt: -1 });
WorkspaceSchema.index({ alias: 1 });

// JSON transform
WorkspaceSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
