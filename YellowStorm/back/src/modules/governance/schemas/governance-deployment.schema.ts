import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type GovernanceDeploymentDocument = HydratedDocument<GovernanceDeployment>;
export type GovernanceDeploymentStatus = 'draft' | 'dry_run' | 'ready_for_review' | 'published' | 'suspended' | 'archived';

export interface GovernanceChannels {
  widget?: { enabled: boolean; tokenId?: Types.ObjectId; allowedOrigins?: string[]; status?: string };
  whatsapp?: { enabled: boolean; integrationId?: Types.ObjectId; phoneNumber?: string; status?: string };
  telegram?: { enabled: boolean; integrationId?: Types.ObjectId; botUsername?: string; status?: string };
}

@Schema({ timestamps: true, collection: 'governance_deployments' })
export class GovernanceDeployment extends Document {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true })
  programId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceScope', required: true, index: true })
  scopeId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 160 })
  name!: string;

  @Prop({ type: String, enum: ['draft', 'dry_run', 'ready_for_review', 'published', 'suspended', 'archived'], default: 'draft', index: true })
  status!: GovernanceDeploymentStatus;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceDeploymentRevision' })
  currentDraftRevisionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceDeploymentRevision' })
  currentPublishedRevisionId?: Types.ObjectId;

  @Prop({ type: Object, default: {} })
  channels!: GovernanceChannels;

  createdAt!: Date;
  updatedAt!: Date;
}

export const GovernanceDeploymentSchema = SchemaFactory.createForClass(GovernanceDeployment);

GovernanceDeploymentSchema.index({ programId: 1, scopeId: 1 }, { unique: true });
GovernanceDeploymentSchema.index({ status: 1, updatedAt: -1 });

GovernanceDeploymentSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
