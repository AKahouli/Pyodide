import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyGovernancePolicyDocument = HydratedDocument<WorkyGovernancePolicy>;

@Schema({ _id: false })
export class WorkyGovernanceCategoryRule {
  @Prop({ type: String, required: true, maxlength: 100 })
  category!: string;

  @Prop({ type: String, enum: ['off', 'notify', 'approval', 'hard_block'], required: true })
  level!: string;
}

const WorkyGovernanceCategoryRuleSchema = SchemaFactory.createForClass(WorkyGovernanceCategoryRule);

/**
 * Workspace-scoped governance policy. `default_level` covers any category
 * not explicitly listed. `max_owner_relax_level` bounds the stream owner
 * override (canonical §5.3).
 */
@Schema({
  timestamps: true,
  collection: 'worky_governance_policies',
})
export class WorkyGovernancePolicy extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId!: Types.ObjectId;

  @Prop({ type: String, enum: ['workspace', 'stream'], required: true, default: 'workspace' })
  scope!: string;

  @Prop({ type: String, enum: ['off', 'notify', 'approval', 'hard_block'], required: true, default: 'off' })
  defaultLevel!: string;

  @Prop({ type: [WorkyGovernanceCategoryRuleSchema], default: [] })
  categories!: WorkyGovernanceCategoryRule[];

  @Prop({ type: Boolean, default: true })
  allowStreamOwnerOverride!: boolean;

  @Prop({ type: String, enum: ['off', 'notify', 'approval', 'hard_block'], default: 'notify' })
  maxOwnerRelaxLevel!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyGovernancePolicySchema = SchemaFactory.createForClass(WorkyGovernancePolicy);

WorkyGovernancePolicySchema.index({ workspaceId: 1, scope: 1 }, { unique: true });

WorkyGovernancePolicySchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
