import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FlowDesignMessageDocument = HydratedDocument<FlowDesignMessage>;

@Schema({ _id: false })
export class FlowDesignSnapshot {
  @Prop({ type: [{ type: Object }], default: [] })
  nodes!: any[];

  @Prop({ type: [{ type: Object }], default: [] })
  controlEdges!: any[];

  @Prop({ type: [{ type: Object }], default: [] })
  dataBindings!: any[];
}

export const FlowDesignSnapshotSchema = SchemaFactory.createForClass(FlowDesignSnapshot);

@Schema({ timestamps: true, collection: 'playbook_flow_design_messages' })
export class FlowDesignMessage {
  @Prop({ type: Types.ObjectId, ref: 'Flow', required: true, index: true })
  flowId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: String, maxlength: 80000, default: '' })
  userQuery!: string;

  @Prop({ type: String, default: '' })
  aiSummary!: string;

  @Prop({ type: FlowDesignSnapshotSchema, required: true })
  snapshotBefore!: FlowDesignSnapshot;

  @Prop({ type: String, enum: ['completed', 'failed', 'reverted'], default: 'completed' })
  status!: string;

  @Prop({ type: Types.ObjectId, ref: 'FlowDesignMessage', default: null })
  revertedFromMessageId!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  error!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const FlowDesignMessageSchema = SchemaFactory.createForClass(FlowDesignMessage);

FlowDesignMessageSchema.index({ flowId: 1, createdAt: -1 });
FlowDesignMessageSchema.index({ flowId: 1, createdBy: 1, createdAt: -1 });

FlowDesignMessageSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
