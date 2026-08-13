import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppSourceRevisionDocument = HydratedDocument<AppSourceRevision>;

@Schema({ _id: false })
export class AppSourceRevisionFile {
  @Prop({ type: String, required: true })
  path!: string;

  @Prop({ type: String, required: true })
  sha256!: string;

  @Prop({ type: String, required: true })
  objectKey!: string;

  @Prop({ type: Number, required: true })
  size!: number;
}

export const AppSourceRevisionFileSchema =
  SchemaFactory.createForClass(AppSourceRevisionFile);

/**
 * Immutable source revision for an App Builder workspace (Conversation V2
 * session id). Content lives in Ceph blobs; this document stores the manifest.
 */
@Schema({ timestamps: true, collection: 'app_source_revisions' })
export class AppSourceRevision {
  @Prop({ type: String, required: true })
  revisionId!: string;

  @Prop({ type: String, required: true, index: true })
  workspaceId!: string;

  @Prop({ type: String, default: null })
  parentRevisionId?: string | null;

  @Prop({ type: String, required: true })
  manifestHash!: string;

  @Prop({ type: String, required: true })
  manifestObjectKey!: string;

  @Prop({ type: [AppSourceRevisionFileSchema], required: true, default: [] })
  files!: AppSourceRevisionFile[];

  @Prop({ type: String, default: null })
  createdByToolCallId?: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AppSourceRevisionSchema = SchemaFactory.createForClass(AppSourceRevision);

AppSourceRevisionSchema.index(
  { workspaceId: 1, revisionId: 1 },
  { unique: true },
);
