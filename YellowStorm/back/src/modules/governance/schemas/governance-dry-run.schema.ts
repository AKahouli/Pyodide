import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type GovernanceDryRunDocument = HydratedDocument<GovernanceDryRun>;

@Schema({ timestamps: true, collection: 'governance_dry_runs' })
export class GovernanceDryRun extends Document {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true })
  programId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceScope', required: true, index: true })
  scopeId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceDeployment', required: true, index: true })
  deploymentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceDeploymentRevision', required: true, index: true })
  revisionId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Conversation' })
  conversationId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  testerId!: Types.ObjectId;

  @Prop({ type: String, enum: ['running', 'passed', 'failed', 'needs_review'], default: 'running', index: true })
  status!: 'running' | 'passed' | 'failed' | 'needs_review';

  @Prop({ type: [Object], default: [] })
  testCases!: Array<Record<string, unknown>>;

  @Prop({ type: Object, default: {} })
  checks!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const GovernanceDryRunSchema = SchemaFactory.createForClass(GovernanceDryRun);

GovernanceDryRunSchema.index({ deploymentId: 1, createdAt: -1 });

GovernanceDryRunSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
