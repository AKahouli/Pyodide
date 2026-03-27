import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkspaceSettingDocument = HydratedDocument<WorkspaceSetting>;

export enum RagType {
  STANDARD = 'standard',
  ADVANCED_RAG = 'advancedRag',
  SMART_RAG = 'smartRag',
}

@Schema({
  timestamps: true,
  collection: 'workspace_settings',
})
export class WorkspaceSetting extends Document {
  @Prop({ required: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({ trim: true, maxlength: 500 })
  description?: string;

  @Prop({ trim: true, maxlength: 50, index: true })
  tag?: string;

  /** @deprecated No longer used for indexing. Kept for backward compatibility with existing data. */
  @Prop({ type: String, maxlength: 100 })
  llmModel?: string;

  @Prop({ default: false, index: true })
  isTemplate!: boolean;

  @Prop({ default: false, index: true })
  isPredefined!: boolean; // Admin-created, read-only templates

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  @Prop({ trim: true, maxlength: 10000 })
  instruction?: string;

  @Prop({ type: Number, default: 5, min: 1, max: 100 })
  chunks!: number;

  @Prop({ default: false })
  hybridSearch!: boolean;

  @Prop({
    type: String,
    enum: RagType,
    default: RagType.STANDARD,
  })
  ragType!: RagType;

  @Prop({ type: Number, default: 4096, min: 100, max: 128000 })
  maxToken!: number;

  @Prop({ type: Number, default: 10, min: 1, max: 100 })
  topK!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkspaceSettingSchema = SchemaFactory.createForClass(WorkspaceSetting);

// Indexes
WorkspaceSettingSchema.index({ createdBy: 1, createdAt: -1 });
WorkspaceSettingSchema.index({ isTemplate: 1, createdAt: -1 });
WorkspaceSettingSchema.index({ tag: 1, isTemplate: 1 });

// JSON transform
WorkspaceSettingSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
