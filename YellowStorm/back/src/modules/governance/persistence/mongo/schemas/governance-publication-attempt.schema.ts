import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type GovernancePublicationAttemptDocument = HydratedDocument<GovernancePublicationAttempt>;
export type GovernancePublicationAttemptStatus = 'success' | 'blocked' | 'failed' | 'partial';

@Schema({ timestamps: true, collection: 'governance_publication_attempts' })
export class GovernancePublicationAttempt extends Document {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true })
  programId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceScope', required: true, index: true })
  scopeId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceDeployment', required: true, index: true })
  deploymentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceDeploymentRevision', index: true })
  revisionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  triggeredByUserId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  triggeredByEmail!: string;

  @Prop({ type: [String], default: [] })
  requestedChannels!: string[];

  @Prop({ type: Boolean, default: false })
  allowPartial!: boolean;

  @Prop({ trim: true, maxlength: 1000 })
  comment?: string;

  @Prop({ type: String, enum: ['success', 'blocked', 'failed', 'partial'], required: true, index: true })
  status!: GovernancePublicationAttemptStatus;

  @Prop({ type: Object, default: {} })
  readinessSnapshot!: Record<string, unknown>;

  @Prop({ trim: true })
  errorCode?: string;

  @Prop({ trim: true, maxlength: 1000 })
  errorMessage?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const GovernancePublicationAttemptSchema = SchemaFactory.createForClass(GovernancePublicationAttempt);

GovernancePublicationAttemptSchema.index({ deploymentId: 1, createdAt: -1 });
GovernancePublicationAttemptSchema.index({ programId: 1, status: 1, createdAt: -1 });
