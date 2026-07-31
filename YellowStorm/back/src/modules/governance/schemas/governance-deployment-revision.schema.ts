import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type GovernanceDeploymentRevisionDocument = HydratedDocument<GovernanceDeploymentRevision>;
export type GovernanceRevisionStatus = 'draft' | 'dry_run' | 'approved' | 'published' | 'rejected';

@Schema({ timestamps: true, collection: 'governance_deployment_revisions' })
export class GovernanceDeploymentRevision extends Document {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceDeployment', required: true, index: true })
  deploymentId!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  revisionNumber!: number;

  @Prop({ type: String, enum: ['draft', 'dry_run', 'approved', 'published', 'rejected'], default: 'draft', index: true })
  status!: GovernanceRevisionStatus;

  @Prop({ type: Types.ObjectId, ref: 'Agent' })
  agentId!: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], ref: 'Agent', default: [] })
  allowedAgentIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Workspace', default: [] })
  workspaceIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'GovernanceSource', default: [] })
  sourceIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'GovernanceSource', default: [] })
  includedSourceIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'GovernanceSource', default: [] })
  excludedSourceIds!: Types.ObjectId[];

  @Prop({ type: Object, default: {} })
  agentSnapshot!: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  sourceSnapshot!: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  workspaceBindingSnapshot!: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  channelSnapshot!: Record<string, unknown>;

  @Prop({ type: String, index: true })
  configurationFingerprint?: string;

  @Prop({ type: Object, default: {} })
  scopeSnapshot!: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  audienceSnapshot!: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  previousAudienceSnapshot!: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  publishedBy?: Types.ObjectId;

  @Prop({ type: Date })
  publishedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const GovernanceDeploymentRevisionSchema = SchemaFactory.createForClass(GovernanceDeploymentRevision);

GovernanceDeploymentRevisionSchema.index({ deploymentId: 1, revisionNumber: 1 }, { unique: true });
GovernanceDeploymentRevisionSchema.index({ deploymentId: 1, status: 1 });

GovernanceDeploymentRevisionSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
