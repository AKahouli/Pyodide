import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import {
  ExecutionSchedule,
  ExecutionScheduleSchema,
} from './execution-schedule.schema';

export type PlaybookDocument = HydratedDocument<Playbook>;

@Schema({ _id: false, strict: false })
export class InputFileItem {
  type!: 'workspace' | 'document';
  id!: string;
  name!: string;
  workspaceId?: string;
  portId?: string;
  metadata?: {
    workspaceId?: string;
    documentId?: string;
    filename?: string;
    filepath?: string;
    language?: string;
    mimeType?: string;
  };
}

export const InputFileItemSchema = SchemaFactory.createForClass(InputFileItem);

@Schema({ _id: false, strict: false })
export class TaskInputPortSchema {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, enum: ['text', 'document', 'code', 'image', 'data', 'slide_deck', 'dashboard'], required: true })
  artifactKind!: string;

  @Prop({ type: Boolean, default: false })
  required!: boolean;

  @Prop({ type: String })
  description?: string;
}

export const TaskInputPortSchemaDefinition = SchemaFactory.createForClass(TaskInputPortSchema);

@Schema({ _id: false, strict: false })
export class TaskOutputPortSchema {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, enum: ['text', 'document', 'code', 'image', 'data', 'slide_deck', 'dashboard'], required: true })
  artifactKind!: string;

  @Prop({ type: String })
  description?: string;
}

export const TaskOutputPortSchemaDefinition = SchemaFactory.createForClass(TaskOutputPortSchema);

@Schema({ _id: false })
export class PlaybookTask {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, trim: true, maxlength: 2000, default: '' })
  description!: string;

  @Prop({ type: Types.ObjectId, ref: 'Agent', default: null })
  assignedAgentId!: Types.ObjectId | null;

  @Prop({ type: Number, default: 0 })
  executionOrder!: number;

  @Prop({ type: Number, default: 0 })
  positionX!: number;

  @Prop({ type: Number, default: 0 })
  positionY!: number;

  @Prop({ type: Boolean, default: false })
  interruptBefore!: boolean;

  @Prop({ type: Boolean, default: false })
  interruptAfter!: boolean;

  @Prop({ type: Boolean, default: false })
  allowClarification!: boolean;

  @Prop({ type: String, trim: true, maxlength: 1000, default: '' })
  clarificationPrompt!: string;

  @Prop({ type: Number, default: 3, min: 1, max: 10 })
  maxClarifications!: number;

  @Prop({ type: [String], default: [] })
  inputKeys!: string[];

  @Prop({ type: String, default: '' })
  outputKey!: string;

  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  @Prop({ type: Boolean, default: false })
  notifyOnComplete!: boolean;

  @Prop({ type: [String], default: [] })
  notifyEmails!: string[];

  @Prop({ type: String, enum: ['live', 'replay_strict', 'replay_flex', 'replay_adaptive'], default: 'live' })
  stepReplayMode!: string;

  @Prop({ type: [InputFileItemSchema], default: [], _id: false })
  inputFiles!: InputFileItem[];

  @Prop({ type: String, enum: ['generic', 'summarizer', 'docxgen', 'slidegen', 'codegen', 'analyzer'], default: 'generic' })
  taskType!: string;

  @Prop({ type: [TaskInputPortSchemaDefinition], default: [], _id: false })
  inputPorts!: TaskInputPortSchema[];

  @Prop({ type: [TaskOutputPortSchemaDefinition], default: [], _id: false })
  outputPorts!: TaskOutputPortSchema[];
}

export const PlaybookTaskSchema = SchemaFactory.createForClass(PlaybookTask);

@Schema({ _id: false })
export class PlaybookEdge {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true })
  sourceId!: string;

  @Prop({ type: String, required: true })
  targetId!: string;

  @Prop({ type: String, default: 'default' })
  sourceOutputPortId!: string;

  @Prop({ type: String, default: 'default' })
  targetInputPortId!: string;
}

export const PlaybookEdgeSchema = SchemaFactory.createForClass(PlaybookEdge);

@Schema({ timestamps: true, collection: 'playbooks' })
export class Playbook extends Document {
  @Prop({ type: String, required: true, trim: true, minlength: 2, maxlength: 100 })
  name!: string;

  @Prop({ type: String, trim: true, maxlength: 2000, default: '' })
  description!: string;

  @Prop({ type: [PlaybookTaskSchema], default: [] })
  tasks!: PlaybookTask[];

  @Prop({ type: [PlaybookEdgeSchema], default: [] })
  edges!: PlaybookEdge[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Workspace' }], default: [] })
  workspaces!: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isFavorite!: boolean;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: String, trim: true })
  integrationToken?: string;

  @Prop({ type: ExecutionScheduleSchema, default: null })
  executionSchedule!: ExecutionSchedule | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PlaybookSchema = SchemaFactory.createForClass(Playbook);

PlaybookSchema.index({ createdBy: 1, updatedAt: -1 });
PlaybookSchema.index({ createdBy: 1, isActive: 1, updatedAt: -1 });
PlaybookSchema.index({ isActive: 1, 'executionSchedule.enabled': 1 });
PlaybookSchema.index({ integrationToken: 1 }, { unique: true, sparse: true });

PlaybookSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
