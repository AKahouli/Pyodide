import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type GovernanceMembershipDocument = HydratedDocument<GovernanceMembership>;

export type GovernanceMembershipRole =
  | 'program_owner'
  | 'program_admin'
  | 'scope_admin'
  | 'scope_approver'
  | 'scope_editor'
  | 'scope_reviewer'
  | 'scope_viewer';

@Schema({ timestamps: true, collection: 'governance_memberships' })
export class GovernanceMembership extends Document {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true })
  programId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GovernanceScope', index: true })
  scopeId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'UserGroup', index: true })
  groupId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  invitedBy!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['program_owner', 'program_admin', 'scope_admin', 'scope_approver', 'scope_editor', 'scope_reviewer', 'scope_viewer'],
    required: true,
    index: true,
  })
  role!: GovernanceMembershipRole;

  @Prop({ type: String, enum: ['invited', 'active', 'disabled'], default: 'active', index: true })
  status!: 'invited' | 'active' | 'disabled';

  @Prop({ type: [String], default: [] })
  permissions!: string[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const GovernanceMembershipSchema = SchemaFactory.createForClass(GovernanceMembership);

GovernanceMembershipSchema.index({ programId: 1, scopeId: 1, userId: 1 }, { unique: true, partialFilterExpression: { userId: { $exists: true } } });
GovernanceMembershipSchema.index({ programId: 1, scopeId: 1, groupId: 1 }, { unique: true, partialFilterExpression: { groupId: { $exists: true } } });
GovernanceMembershipSchema.index({ userId: 1, status: 1 });
GovernanceMembershipSchema.index({ groupId: 1, status: 1 });

GovernanceMembershipSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
