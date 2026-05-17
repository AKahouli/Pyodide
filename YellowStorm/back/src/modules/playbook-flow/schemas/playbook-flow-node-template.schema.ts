import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type FlowNodeTemplateDocument = HydratedDocument<FlowNodeTemplate>;

@Schema({ timestamps: true, collection: 'playbook_flow_node_templates' })
export class FlowNodeTemplate {
  @Prop({ required: true, unique: true, index: true, trim: true, maxlength: 120 })
  key!: string;

  @Prop({ required: true, unique: true, index: true, trim: true, maxlength: 120 })
  type!: string;

  @Prop({
    required: true,
    trim: true,
    enum: ['agent', 'action', 'evaluation', 'iterator', 'router', 'human_approval'],
  })
  nodeType!: 'agent' | 'action' | 'evaluation' | 'iterator' | 'router' | 'human_approval';

  @Prop({ required: true, trim: true, maxlength: 160 })
  title!: string;

  @Prop({ trim: true, maxlength: 600 })
  description?: string;

  @Prop({ trim: true, maxlength: 80 })
  icon?: string;

  @Prop({ trim: true, maxlength: 40 })
  color?: string;

  @Prop({ required: true, trim: true, maxlength: 80, index: true })
  category!: string;

  @Prop({
    type: [{
      _id: false,
      id: { type: String, required: true, trim: true },
      name: { type: String, required: true, trim: true },
      artifactKind: { type: String, required: true, trim: true },
      required: { type: Boolean, required: true },
      description: { type: String, trim: true },
    }],
    default: [],
  })
  inputPorts!: Array<{
    id: string;
    name: string;
    artifactKind: string;
    required: boolean;
    description?: string;
  }>;

  @Prop({
    type: [{
      _id: false,
      id: { type: String, required: true, trim: true },
      name: { type: String, required: true, trim: true },
      artifactKind: { type: String, required: true, trim: true },
      description: { type: String, trim: true },
    }],
    default: [],
  })
  outputPorts!: Array<{
    id: string;
    name: string;
    artifactKind: string;
    description?: string;
  }>;

  @Prop({ type: String, default: '' })
  promptTemplate!: string;

  @Prop({ type: String, default: null, trim: true })
  recommendedAgentTypeSlug!: string | null;

  @Prop({ type: [String], default: [] })
  requiredToolNames!: string[];

  @Prop({ type: String, default: 'agent', trim: true, maxlength: 40 })
  executionMode!: string;

  @Prop({ type: String, default: null, trim: true })
  assignedAgentId!: string | null;

  @Prop({ type: String, default: null, trim: true })
  selectedAction!: string | null;

  @Prop({
    type: {
      source: { type: String, trim: true, maxlength: 400 },
      mode: { type: String, trim: true, enum: ['item', 'batch'] },
      batchSize: { type: Number, min: 1, default: null },
      itemVariable: { type: String, trim: true, maxlength: 120, default: null },
      outputVariable: { type: String, trim: true, maxlength: 120, default: null },
      errorStrategy: { type: String, trim: true, enum: ['stop', 'continue'], default: 'stop' },
    },
    default: null,
  })
  iteratorConfig!: {
    source: string;
    mode: 'item' | 'batch';
    batchSize?: number | null;
    itemVariable?: string | null;
    outputVariable?: string | null;
    errorStrategy?: 'stop' | 'continue';
  } | null;

  @Prop({ type: Boolean, default: true, index: true })
  enabled!: boolean;

  @Prop({
    type: {
      outputLabels: { type: [String], default: [] },
      maxIterations: { type: Number, min: 1, default: 1 },
      conditions: {
        type: [{
          label: { type: String, required: true, trim: true },
          sourceNode: { type: String, default: null },
          sourcePort: { type: String, default: null },
          path: { type: String, default: null },
          operator: { type: String, enum: ['equals', 'not_equals', 'contains', 'exists', 'gt', 'gte', 'lt', 'lte'], required: true },
          value: { type: SchemaTypes.Mixed, default: null },
        }],
        default: [],
      },
      defaultLabel: { type: String, default: null },
    },
    default: null,
  })
  routerConfig!: {
    outputLabels: string[];
    maxIterations: number;
    conditions?: Array<{
      label: string;
      sourceNode?: string | null;
      sourcePort?: string | null;
      path?: string | null;
      operator: 'equals' | 'not_equals' | 'contains' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';
      value?: unknown;
    }>;
    defaultLabel?: string | null;
  } | null;

  @Prop({
    type: {
      promptTemplate: { type: String, trim: true, default: '' },
      timeoutSeconds: { type: Number, min: 0, default: null },
    },
    default: null,
  })
  humanApprovalConfig!: {
    promptTemplate: string;
    timeoutSeconds?: number | null;
  } | null;

  @Prop({ type: Number, default: 1, min: 1 })
  version!: number;

  @Prop({ type: Boolean, default: false })
  isBuiltIn!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy!: Types.ObjectId | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const FlowNodeTemplateSchema = SchemaFactory.createForClass(FlowNodeTemplate);

FlowNodeTemplateSchema.index({ category: 1, enabled: 1 });
FlowNodeTemplateSchema.index({ enabled: 1, title: 1 });

FlowNodeTemplateSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
