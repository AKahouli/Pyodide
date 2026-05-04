import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkspaceDocumentDoc = HydratedDocument<WorkspaceDoc>;

export enum DocumentStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum IndexingStatus {
  NONE = 'none',
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

@Schema({
  timestamps: true,
  collection: 'workspace_documents',
})
export class WorkspaceDoc extends Document {
  @Prop({ required: true, trim: true, maxlength: 255 })
  filename!: string;

  @Prop({ required: true, trim: true, maxlength: 255 })
  originalName!: string;

  @Prop({ required: true, maxlength: 100 })
  mimeType!: string;

  @Prop({ required: true, min: 0 })
  size!: number;

  @Prop({ required: true, maxlength: 500 })
  path!: string;

  @Prop({ maxlength: 1000 })
  url?: string;

  @Prop({ maxlength: 64 })
  contentHash?: string;

  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  @Prop({
    type: String,
    enum: DocumentStatus,
    default: DocumentStatus.PENDING,
    index: true,
  })
  status!: DocumentStatus;

  @Prop()
  uploadedAt?: Date;

  @Prop({ maxlength: 500 })
  errorMessage?: string;

  @Prop({ type: Object })
  metadata?: Record<string, string>;

  @Prop({
    type: String,
    enum: IndexingStatus,
    default: IndexingStatus.NONE,
    index: true,
  })
  indexingStatus!: IndexingStatus;

  @Prop({ type: String })
  indexingError?: string;

  @Prop({ type: String })
  indexingTaskName?: string;

  @Prop({ type: String })
  indexingTaskId?: string;

  @Prop({ type: Date })
  lastIndexedAt?: Date;

  @Prop({ type: Date })
  indexingStartedAt?: Date;

  @Prop({ type: String })
  detected_language?: string; 

  @Prop({ default: 1200 })
  chunk_size?: number;


  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkspaceDocumentSchema = SchemaFactory.createForClass(WorkspaceDoc);

// Indexes
WorkspaceDocumentSchema.index({ workspaceId: 1, createdAt: -1 });
WorkspaceDocumentSchema.index({ workspaceId: 1, status: 1 });
WorkspaceDocumentSchema.index({ path: 1 }, { unique: true });

// JSON transform
WorkspaceDocumentSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
