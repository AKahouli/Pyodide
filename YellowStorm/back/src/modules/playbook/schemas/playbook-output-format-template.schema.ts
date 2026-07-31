import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PlaybookOutputFormatTemplateDocument = HydratedDocument<PlaybookOutputFormatTemplate>;

export enum OutputFormatTemplateStatus {
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
}

const OutputFormatPromptTraceItemSchema = SchemaFactory.createForClass(OutputFormatPromptTraceItem);

@Schema({
  collection: 'playbook_output_format_templates',
  timestamps: true,
  versionKey: false,
})
export class PlaybookOutputFormatTemplate {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  playbookId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  taskId!: string;

  @Prop({ type: Types.ObjectId, required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  sourceExecutionId!: Types.ObjectId;

  @Prop({ required: true })
  sourceExecutionNumber!: number;

  @Prop({ required: true })
  templateVersion!: number;

  @Prop({ required: true, enum: OutputFormatTemplateStatus, default: OutputFormatTemplateStatus.ACTIVE })
  status!: OutputFormatTemplateStatus;

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

export const PlaybookOutputFormatTemplateSchema =
  SchemaFactory.createForClass(PlaybookOutputFormatTemplate);

PlaybookOutputFormatTemplateSchema.index(
  { playbookId: 1, taskId: 1, status: 1 },
  { name: 'playbook_task_active_format_template_idx' },
);
