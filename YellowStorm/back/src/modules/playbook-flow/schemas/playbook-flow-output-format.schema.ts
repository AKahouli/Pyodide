import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FlowOutputFormatDocument = HydratedDocument<FlowOutputFormat>;

export enum OutputFormatStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export enum OutputFormatGenerationStatus {
  PENDING = 'pending',
  READY = 'ready',
  FAILED = 'failed',
}

@Schema({ _id: false })
export class OutputFormatPromptTraceItem {
  @Prop({ required: true })
  stage!: string;

  @Prop({ required: true })
  model!: string;

  @Prop({ required: true })
  prompt!: string;

  @Prop({ required: false, type: String, default: null })
  generatedOutput?: string | null;
}

const OutputFormatPromptTraceItemSchema = SchemaFactory.createForClass(OutputFormatPromptTraceItem);

@Schema({ collection: 'playbook_flow_output_formats', timestamps: true, versionKey: false })
export class FlowOutputFormat {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  flowId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  nodeId!: string;

  @Prop({ type: Types.ObjectId, required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  sourceExecutionId!: Types.ObjectId;

  @Prop({ required: true })
  sourceExecutionNumber!: number;

  @Prop({ required: true })
  templateVersion!: number;

  @Prop({ required: true, enum: OutputFormatStatus, default: OutputFormatStatus.ACTIVE })
  status!: OutputFormatStatus;

  @Prop({ required: true, enum: OutputFormatGenerationStatus, default: OutputFormatGenerationStatus.PENDING })
  generationStatus!: OutputFormatGenerationStatus;

  @Prop({ type: String, default: null })
  generationError!: string | null;

  @Prop({ type: String, default: null })
  sourceOutput!: string | null;

  @Prop({ type: String, default: null })
  formatGuide!: string | null;

  @Prop({ type: [OutputFormatPromptTraceItemSchema], default: [] })
  llmPromptTrace!: OutputFormatPromptTraceItem[];
}

export const FlowOutputFormatSchema = SchemaFactory.createForClass(FlowOutputFormat);

FlowOutputFormatSchema.index(
  { flowId: 1, nodeId: 1, status: 1 },
  { name: 'flow_node_active_output_format_idx' },
);
