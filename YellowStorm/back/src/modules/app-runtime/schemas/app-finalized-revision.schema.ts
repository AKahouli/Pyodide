import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppFinalizedRevisionDocument = HydratedDocument<AppFinalizedRevision>;

/**
 * Stable App Builder version: a workspace revision that passed MCP finalize.
 * Content lives in Ceph via app_source_revisions; this row is the product catalog.
 */
@Schema({ timestamps: true, collection: 'app_finalized_revisions' })
export class AppFinalizedRevision {
  @Prop({ type: String, required: true, index: true })
  workspaceId!: string;

  @Prop({ type: String, required: true })
  revisionId!: string;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: Date, required: true })
  finalizedAt!: Date;

  @Prop({ type: String, required: true })
  eventId!: string;

  @Prop({ type: Number, default: null })
  fileCount?: number | null;

  @Prop({ type: String, default: null })
  cephManifestPath?: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AppFinalizedRevisionSchema =
  SchemaFactory.createForClass(AppFinalizedRevision);

AppFinalizedRevisionSchema.index(
  { workspaceId: 1, revisionId: 1 },
  { unique: true },
);
AppFinalizedRevisionSchema.index({ workspaceId: 1, finalizedAt: -1 });
