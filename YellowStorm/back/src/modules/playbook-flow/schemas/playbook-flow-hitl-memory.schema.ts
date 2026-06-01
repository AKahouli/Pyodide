import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlowHitlMemoryDocument = HydratedDocument<FlowHitlMemory>;

@Schema({ timestamps: true })
export class FlowHitlMemory {
  /** Persistent, user-approved HITL guidance that can be injected into future workflow runs. */
  @Prop({ required: true, type: String })
  ownerId!: string;

  @Prop({ required: true, type: String })
  flowId!: string;

  @Prop({ required: false, type: String, default: null })
  nodeId?: string | null;

  @Prop({ required: true, type: String, enum: ['semantic', 'episodic', 'procedural', 'approval_policy'], default: 'procedural' })
  memoryType!: string;

  @Prop({ required: true, type: String, enum: ['hitl_feedback', 'blocker_rule', 'replay_validation', 'manual'], default: 'hitl_feedback' })
  source!: string;

  @Prop({ required: true, type: String })
  title!: string;

  @Prop({ required: true, type: String })
  content!: string;

  @Prop({ required: true, type: String })
  normalizedInstruction!: string;

  @Prop({ required: true, type: String, enum: ['node', 'workflow', 'agent', 'workspace'], default: 'workflow' })
  appliesTo!: string;

  @Prop({ required: true, type: String, enum: ['active', 'draft', 'archived'], default: 'draft' })
  status!: string;

  @Prop({ required: true, type: String, enum: ['normal', 'sensitive'], default: 'normal' })
  sensitivity!: string;

  @Prop({ required: false, type: String })
  createdFromExecutionId?: string;

  @Prop({ required: false, type: String })
  createdFromInterruptId?: string;

  createdAt?: Date;

  updatedAt?: Date;
}

export const FlowHitlMemorySchema = SchemaFactory.createForClass(FlowHitlMemory);

FlowHitlMemorySchema.index({ ownerId: 1, flowId: 1, status: 1 });
FlowHitlMemorySchema.index({ ownerId: 1, flowId: 1, nodeId: 1 });

FlowHitlMemorySchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
