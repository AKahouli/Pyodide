import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import {
  ExecutionSchedule,
  ExecutionScheduleSchema,
} from './execution-schedule.schema';

@Schema({ _id: false })
export class PlaybookMailTriggerFilters {
  @Prop({ type: [String], default: [] })
  from!: string[];

  @Prop({ type: [String], default: [] })
  subjectContains!: string[];

  @Prop({ type: [String], default: [] })
  bodyContains!: string[];

  @Prop({ type: Boolean, default: null })
  hasAttachments!: boolean | null;
}

export const PlaybookMailTriggerFiltersSchema = SchemaFactory.createForClass(PlaybookMailTriggerFilters);

@Schema({ _id: false })
export class PlaybookMailTrigger {
  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  @Prop({ type: String, default: null })
  mailboxAppKey!: string | null;

  @Prop({ type: String, default: null })
  notificationUrl!: string | null;

  @Prop({ type: Date, default: null })
  autoRenewUntil!: Date | null;

  @Prop({ type: Boolean, default: false })
  attachmentImportEnabled!: boolean;

  @Prop({ type: [String], default: [] })
  allowedAttachmentExtensions!: string[];

  @Prop({ type: Boolean, default: false })
  runtimeEnabled!: boolean;

  @Prop({ type: String, default: null })
  subscriptionId!: string | null;

  @Prop({ type: String, default: null })
  subscriptionClientState!: string | null;

  @Prop({ type: Date, default: null })
  subscriptionExpiresAt!: Date | null;

  @Prop({ type: PlaybookMailTriggerFiltersSchema, default: () => ({}) })
  filters!: PlaybookMailTriggerFilters;
}

export const PlaybookMailTriggerSchema = SchemaFactory.createForClass(PlaybookMailTrigger);

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
export class ToolBindingAction {
  actionKey!: string;
  isEnabled?: boolean;
}

export const ToolBindingActionSchema = SchemaFactory.createForClass(ToolBindingAction);

@Schema({ _id: false, strict: false })
export class ToolBinding {
  id!: string;
  connectorId!: string;
  actions!: ToolBindingAction[];
  credentialId?: string | null;
  fixedParams?: Record<string, unknown>;
  disableAutoSkills?: boolean;
  isEnabled?: boolean;
}

export const ToolBindingSchema = SchemaFactory.createForClass(ToolBinding);

@Schema({ _id: false, strict: false })
export class TaskInputPortSchema {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, enum: ['text', 'document', 'code', 'image', 'data', 'dashboard'], required: true })
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

  @Prop({ type: String, enum: ['text', 'document', 'code', 'image', 'data', 'dashboard'], required: true })
  artifactKind!: string;

  @Prop({ type: String })
  description?: string;
}

export const TaskOutputPortSchemaDefinition = SchemaFactory.createForClass(TaskOutputPortSchema);

@Schema({ _id: false })
export class PlaybookEvaluationRubricWeights {
  @Prop({ type: Number, default: 40 })
  semanticMatch!: number;

  @Prop({ type: Number, default: 20 })
  referenceMatch!: number;

  @Prop({ type: Number, default: 20 })
  artifactRequirements!: number;

  @Prop({ type: Number, default: 10 })
  formatCompliance!: number;

  @Prop({ type: Number, default: 5 })
  evidenceConsistency!: number;

  @Prop({ type: Number, default: 5 })
  executionHealth!: number;
}

export const PlaybookEvaluationRubricWeightsSchema = SchemaFactory.createForClass(PlaybookEvaluationRubricWeights);

@Schema({ _id: false })
export class PlaybookEvaluationConfig {
  @Prop({ type: String, trim: true, maxlength: 10000, default: '' })
  expectation!: string;

  @Prop({ type: String, default: null })
  referenceBaselineId!: string | null;

  @Prop({ type: Number, default: 80, min: 0, max: 100 })
  passThreshold!: number;

  @Prop({ type: Number, default: 60, min: 0, max: 100 })
  warningThreshold!: number;

  @Prop({ type: Number, default: 1, min: 0 })
  weight!: number;

  @Prop({ type: String, trim: true, maxlength: 200, default: 'evaluation-node-v1' })
  rubricVersion!: string;

  @Prop({ type: PlaybookEvaluationRubricWeightsSchema, default: () => ({}) })
  weights!: PlaybookEvaluationRubricWeights;
}

export const PlaybookEvaluationConfigSchema = SchemaFactory.createForClass(PlaybookEvaluationConfig);

@Schema({ _id: false })
export class PlaybookIteratorConfig {
  @Prop({ type: String, trim: true, default: '{{items}}' })
  source!: string;

  @Prop({ type: String, enum: ['item', 'batch'], default: 'item' })
  mode!: string;

  @Prop({ type: Number, default: 10, min: 1 })
  batchSize!: number;

  @Prop({ type: String, trim: true, default: 'item' })
  itemVariable!: string;

  @Prop({ type: String, trim: true, default: 'processed_items' })
  outputVariable!: string;

  @Prop({ type: String, enum: ['stop', 'continue'], default: 'stop' })
  errorStrategy!: string;
}

export const PlaybookIteratorConfigSchema = SchemaFactory.createForClass(PlaybookIteratorConfig);

@Schema({ _id: false })
export class PlaybookContainerConfig {
  @Prop({ type: String, default: null })
  parentIteratorId!: string | null;
}

export const PlaybookContainerConfigSchema = SchemaFactory.createForClass(PlaybookContainerConfig);

@Schema({ _id: false })
export class PlaybookIteratorLayout {
  @Prop({ type: Number, default: null })
  width!: number | null;

  @Prop({ type: Number, default: null })
  height!: number | null;
}

export const PlaybookIteratorLayoutSchema = SchemaFactory.createForClass(PlaybookIteratorLayout);

@Schema({ _id: false })
export class PlaybookDesignSettings {
  @Prop({ type: String, default: null })
  inferenceModelId!: string | null;

  @Prop({ type: String, enum: ['inherit', 'auto', 'manual'], default: 'inherit' })
  nodeSuggestionsMode!: string;

  @Prop({ type: String, enum: ['inherit', 'auto', 'manual'], default: 'inherit' })
  approvalSuggestionMode!: string;
}

export const PlaybookDesignSettingsSchema = SchemaFactory.createForClass(PlaybookDesignSettings);

@Schema({ _id: false })
export class PlaybookTask {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, trim: true, maxlength: 20000, default: '' })
  description!: string;

  @Prop({ type: Types.ObjectId, ref: 'Agent', default: null })
  assignedAgentId!: Types.ObjectId | null;

  @Prop({ type: String, enum: ['agent', 'action'], default: 'agent' })
  executionMode!: string;

  @Prop({ type: String, enum: ['index', 'delete', 'read'], default: null })
  selectedAction!: string | null;

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

  @Prop({ type: String, enum: ['generic', 'summarizer', 'docxgen', 'slidegen', 'codegen', 'analyzer', 'evaluation', 'iterator'], default: 'generic' })
  taskType!: string;

  @Prop({ type: String, enum: ['agent', 'action', 'evaluation', 'iterator'], default: null })
  nodeType!: string | null;

  @Prop({ type: String, default: null, trim: true, maxlength: 120 })
  templateType!: string | null;

  @Prop({ type: [TaskInputPortSchemaDefinition], default: [], _id: false })
  inputPorts!: TaskInputPortSchema[];

  @Prop({ type: [TaskOutputPortSchemaDefinition], default: [], _id: false })
  outputPorts!: TaskOutputPortSchema[];

  @Prop({ type: [ToolBindingSchema], default: [], _id: false })
  toolBindings!: ToolBinding[];

  @Prop({ type: Boolean, default: false })
  advisorAutopilotEnabled!: boolean;

  @Prop({ type: Number, default: 90 })
  advisorAutopilotTargetScore!: number;

  @Prop({ type: Number, default: 4 })
  advisorAutopilotMaxTurns!: number;

  @Prop({ type: Boolean, default: false })
  disableAdvisorEvaluation!: boolean;

  @Prop({ type: Date, default: null })
  advisorOptimizedAt!: Date | null;

  @Prop({ type: PlaybookEvaluationConfigSchema, default: null })
  evaluationConfig!: PlaybookEvaluationConfig | null;

  @Prop({ type: PlaybookIteratorConfigSchema, default: null })
  iteratorConfig!: PlaybookIteratorConfig | null;

  @Prop({ type: PlaybookContainerConfigSchema, default: null })
  containerConfig!: PlaybookContainerConfig | null;

  @Prop({ type: PlaybookIteratorLayoutSchema, default: null })
  iteratorLayout!: PlaybookIteratorLayout | null;

  @Prop({ type: String, default: null })
  expectedResult!: string | null;
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

  @Prop({ type: String, trim: true, maxlength: 20000, default: '' })
  description!: string;

  @Prop({ type: PlaybookDesignSettingsSchema, default: () => ({}) })
  designSettings!: PlaybookDesignSettings;

  @Prop({ type: [PlaybookTaskSchema], default: [] })
  tasks!: PlaybookTask[];

  @Prop({ type: [PlaybookEdgeSchema], default: [] })
  edges!: PlaybookEdge[];

  @Prop({ type: Boolean, default: true })
  reflectionEnabled!: boolean;

  @Prop({ type: Boolean, default: false })
  advisorAutopilotEnabled!: boolean;

  @Prop({ type: Number, default: 90 })
  advisorAutopilotTargetScore!: number;

  @Prop({ type: Number, default: 4 })
  advisorAutopilotMaxTurns!: number;

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

  @Prop({ type: PlaybookMailTriggerSchema, default: null })
  mailTrigger!: PlaybookMailTrigger | null;

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
