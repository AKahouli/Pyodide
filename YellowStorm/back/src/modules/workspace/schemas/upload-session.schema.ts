import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type UploadSessionDocument = HydratedDocument<UploadSession>;

export enum UploadSessionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
  FAILED = 'failed',
}

@Schema({ _id: false })
export class UploadFileInfo {
  @Prop({ required: true })
  index!: number;

  @Prop({ required: true, maxlength: 255 })
  filename!: string;

  @Prop({ required: true, maxlength: 100 })
  mimeType!: string;

  @Prop({ required: true })
  size!: number;

  @Prop({ type: Types.ObjectId, ref: 'WorkspaceDoc' })
  documentId?: Types.ObjectId;

  @Prop({ maxlength: 2000 })
  uploadUrl?: string;

  @Prop({
    type: String,
    enum: ['pending', 'uploading', 'completed', 'failed'],
    default: 'pending',
  })
  status!: string;

  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  progress!: number;

  @Prop({ maxlength: 500 })
  error?: string;
}

@Schema({
  timestamps: true,
  collection: 'upload_sessions',
})
export class UploadSession extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: UploadSessionStatus,
    default: UploadSessionStatus.PENDING,
    index: true,
  })
  status!: UploadSessionStatus;

  @Prop({ type: [UploadFileInfo], default: [] })
  files!: UploadFileInfo[];

  @Prop({ required: true })
  totalFiles!: number;

  @Prop({ required: true })
  totalSize!: number;

  @Prop({ type: Number, default: 0 })
  completedFiles!: number;

  @Prop({ type: Number, default: 0 })
  failedFiles!: number;

  @Prop({ required: true })
  expiresAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UploadSessionSchema = SchemaFactory.createForClass(UploadSession);

// Indexes
UploadSessionSchema.index({ workspaceId: 1, status: 1 });
UploadSessionSchema.index({ userId: 1, createdAt: -1 });
UploadSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

// JSON transform
UploadSessionSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
