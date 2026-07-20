import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { DEFAULT_DECISION_FLOW_GENERATION_OPTIONS, WorkspaceArtifactStatus, WorkspaceArtifactType } from '../interfaces/workspace-artifact.interface';
import type { DecisionFlowGenerationOptions } from '../interfaces/workspace-artifact.interface';
import type { DecisionFlowPayload } from '../interfaces/decision-flow.interface';

export type WorkspaceArtifactDocument = HydratedDocument<WorkspaceArtifact>;

@Schema({ timestamps: true, collection: 'workspace_artifacts' })
export class WorkspaceArtifact {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true }) workspaceId!: Types.ObjectId;
  @Prop({ enum: WorkspaceArtifactType, required: true, index: true }) type!: WorkspaceArtifactType;
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 150 }) name!: string;
  @Prop({ trim: true, maxlength: 1000 }) description?: string;
  @Prop({ enum: WorkspaceArtifactStatus, required: true, default: WorkspaceArtifactStatus.QUEUED, index: true }) status!: WorkspaceArtifactStatus;
  @Prop({ required: true, default: 1, min: 1 }) schemaVersion!: number;
  @Prop({ required: true, default: 0, min: 0 }) revision!: number;
  @Prop({ type: Object, required: true }) primarySource!: { documentId: Types.ObjectId; documentName: string; contentHash?: string; selection: { mode: 'all' } | { mode: 'pages'; pages: number[] } };
  @Prop({ type: Object, required: true, default: () => ({ ...DEFAULT_DECISION_FLOW_GENERATION_OPTIONS, targetAudiences: [...DEFAULT_DECISION_FLOW_GENERATION_OPTIONS.targetAudiences], ambiguityPolicy: { ...DEFAULT_DECISION_FLOW_GENERATION_OPTIONS.ambiguityPolicy } }) }) generationOptions!: DecisionFlowGenerationOptions;
  @Prop({ type: Object }) payload?: DecisionFlowPayload;
  @Prop({ type: Object, required: true }) generation!: { agentId: Types.ObjectId; requestedBy: Types.ObjectId; attempts: number; startedAt?: Date; completedAt?: Date; error?: string; leaseToken?: string; leaseExpiresAt?: Date; nextAttemptAt?: Date; usage?: { inputTokens: number; outputTokens: number; model?: string } };
  @Prop({ type: Types.ObjectId, ref: 'WorkspaceArtifact' }) clonedFromArtifactId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true }) createdBy!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) updatedBy!: Types.ObjectId;
  createdAt!: Date; updatedAt!: Date;
}

export const WorkspaceArtifactSchema = SchemaFactory.createForClass(WorkspaceArtifact);
WorkspaceArtifactSchema.index({ workspaceId: 1, type: 1, updatedAt: -1 });
WorkspaceArtifactSchema.index({ workspaceId: 1, 'primarySource.documentId': 1, updatedAt: -1 });
WorkspaceArtifactSchema.index({ status: 1, 'generation.nextAttemptAt': 1, createdAt: 1 });
WorkspaceArtifactSchema.index({ status: 1, 'generation.leaseExpiresAt': 1 });
