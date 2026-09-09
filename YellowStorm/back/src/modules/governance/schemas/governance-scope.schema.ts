import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { GovernanceScopeAudienceMode } from '../domain/governance-scope-audience';

export type GovernanceScopeDocument = HydratedDocument<GovernanceScope>;

@Schema({ _id: false })
export class GovernanceScopeAudienceSchemaClass {
  @Prop({ type: String, enum: ['all_authenticated', 'restricted'], default: 'restricted' })
  mode!: GovernanceScopeAudienceMode;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  userIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'UserGroup', default: [] })
  groupIds!: Types.ObjectId[];
}

const GovernanceScopeAudienceSchema = SchemaFactory.createForClass(GovernanceScopeAudienceSchemaClass);

export type GovernanceScopeKnowledgeSourceMode = 'llm_only' | 'workspaces_only';

@Schema({ _id: false })
export class GovernanceScopeKnowledgeSchemaClass {
  @Prop({ type: String, enum: ['llm_only', 'workspaces_only'], default: 'llm_only' })
  sourceMode!: GovernanceScopeKnowledgeSourceMode;

  @Prop({ type: Boolean, default: false })
  webSourcesEnabled!: boolean;

  @Prop({ type: [String], default: [] })
  webAllowedDomains!: string[];

  @Prop({ type: [String], default: [] })
  webBlockedDomains!: string[];
}

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

  @Prop({
    type: GovernanceScopeAudienceSchema,
    default: () => ({ mode: 'restricted', userIds: [], groupIds: [] }),
  })
  audience!: GovernanceScopeAudienceSchemaClass;

  @Prop({ type: GovernanceScopeKnowledgeSchemaClass, default: () => ({}) })
  knowledge!: GovernanceScopeKnowledgeSchemaClass;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const GovernanceScopeSchema = SchemaFactory.createForClass(GovernanceScope);

GovernanceScopeSchema.index({ programId: 1, name: 1 }, { unique: true });
GovernanceScopeSchema.index({ programId: 1, type: 1 });
GovernanceScopeSchema.index({ 'audience.userIds': 1 });
GovernanceScopeSchema.index({ 'audience.groupIds': 1 });
GovernanceScopeSchema.index({ status: 1, 'audience.mode': 1 });

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
