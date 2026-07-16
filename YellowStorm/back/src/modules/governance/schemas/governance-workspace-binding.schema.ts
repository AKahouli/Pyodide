import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { GovernanceSourceVisibility } from './governance-source.schema';
import type { SourceValidityMode } from '../domain/source-validity';

export type GovernanceWorkspaceBindingDocument = HydratedDocument<GovernanceWorkspaceBinding>;
export type GovernanceWorkspaceIngestionMode = 'manual' | 'assisted' | 'automatic';

@Schema({ timestamps: true, collection: 'governance_workspace_bindings' })
export class GovernanceWorkspaceBinding {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true }) programId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true }) workspaceId!: Types.ObjectId;
  @Prop({ type: String, enum: ['program_shared', 'scope_specific', 'multi_scope'], required: true, index: true }) visibility!: GovernanceSourceVisibility;
  @Prop({ type: [Types.ObjectId], ref: 'GovernanceScope', default: [], index: true }) scopeIds!: Types.ObjectId[];
  @Prop({ default: true, index: true }) enabled!: boolean;
  @Prop({ type: String, enum: ['manual', 'assisted', 'automatic'], default: 'assisted' }) ingestionMode!: GovernanceWorkspaceIngestionMode;
  @Prop({ type: Object, default: {} }) defaults!: { sourceType?: string; ownerUserId?: string; ownerScopeId?: string; reviewFrequencyDays?: number; validityMode?: SourceValidityMode };
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;
}
export const GovernanceWorkspaceBindingSchema = SchemaFactory.createForClass(GovernanceWorkspaceBinding);
GovernanceWorkspaceBindingSchema.index({ programId: 1, workspaceId: 1 }, { unique: true });
GovernanceWorkspaceBindingSchema.index({ programId: 1, scopeIds: 1 });
GovernanceWorkspaceBindingSchema.index({ workspaceId: 1, enabled: 1 });
GovernanceWorkspaceBindingSchema.set('toJSON', {
  virtuals: true,
  transform: (_document, returned) => {
    const serialized = returned as unknown as Record<string, unknown>;
    serialized.id = serialized._id?.toString();
    delete serialized._id;
    delete serialized.__v;
    return serialized;
  },
});
