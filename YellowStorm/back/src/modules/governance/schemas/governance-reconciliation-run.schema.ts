import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GovernanceReconciliationRunDocument = HydratedDocument<GovernanceReconciliationRun>;
export type GovernanceReconciliationRunStatus = 'pending' | 'running' | 'completed' | 'failed';

@Schema({ timestamps: true, collection: 'governance_reconciliation_runs', suppressReservedKeysWarning: true })
export class GovernanceReconciliationRun {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceWorkspaceBinding', required: true, index: true }) bindingId!: Types.ObjectId;
  @Prop({ type: String, enum: ['pending', 'running', 'completed', 'failed'], default: 'pending', index: true }) status!: GovernanceReconciliationRunStatus;
  @Prop({ default: true }) dryRun!: boolean;
  @Prop() cursor?: string;
  @Prop({ type: Object, default: {} }) stats!: Record<string, number>;
  @Prop({ type: Array, default: [] }) errors!: Array<{ documentId?: string; message: string }>;
  @Prop() startedAt?: Date;
  @Prop() completedAt?: Date;
  @Prop({ index: true }) leaseToken?: string;
  @Prop({ index: true }) leaseExpiresAt?: Date;
}

export const GovernanceReconciliationRunSchema = SchemaFactory.createForClass(GovernanceReconciliationRun);
GovernanceReconciliationRunSchema.index({ bindingId: 1, createdAt: -1 });
GovernanceReconciliationRunSchema.index({ status: 1, leaseExpiresAt: 1 });
GovernanceReconciliationRunSchema.set('toJSON', { virtuals: true, transform: (_document, returned) => { const serialized = returned as unknown as Record<string, unknown>; serialized.id = serialized._id?.toString(); delete serialized._id; delete serialized.__v; delete serialized.leaseToken; delete serialized.leaseExpiresAt; return serialized; } });
