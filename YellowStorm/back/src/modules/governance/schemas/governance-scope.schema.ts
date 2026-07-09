import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type GovernanceScopeDocument = HydratedDocument<GovernanceScope>;

export type GovernanceScopeType =
  | 'organization'
  | 'municipality'
  | 'department'
  | 'business_unit'
  | 'country'
  | 'team'
  | 'custom';

@Schema({ timestamps: true, collection: 'governance_scopes' })
export class GovernanceScope extends Document {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true })
  programId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceScope', index: true })
  parentScopeId?: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 160 })
  name!: string;

  @Prop({
    type: String,
    enum: ['organization', 'municipality', 'department', 'business_unit', 'country', 'team', 'custom'],
    default: 'custom',
    index: true,
  })
  type!: GovernanceScopeType;

  @Prop({ type: String, enum: ['active', 'inactive'], default: 'active', index: true })
  status!: 'active' | 'inactive';

  @Prop({ type: [Types.ObjectId], ref: 'Agent', default: [], index: true })
  agentIds!: Types.ObjectId[];

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const GovernanceScopeSchema = SchemaFactory.createForClass(GovernanceScope);

GovernanceScopeSchema.index({ programId: 1, name: 1 }, { unique: true });
GovernanceScopeSchema.index({ programId: 1, type: 1 });

GovernanceScopeSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
