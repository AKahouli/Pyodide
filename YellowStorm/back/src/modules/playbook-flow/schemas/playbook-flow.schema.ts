import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ControlEdge, DataBinding } from './playbook-flow-graph.schema';
import { DEFAULT_HITL_POLICY, HitlBlockerRule, HitlPolicy } from './playbook-flow-hitl.schema';

export type FlowDocument = HydratedDocument<Flow>;

export const ADVISOR_SCORING_MODES = ['llm', 'heuristic'] as const;
export type AdvisorScoringMode = (typeof ADVISOR_SCORING_MODES)[number];
export { ControlEdge, DataBinding } from './playbook-flow-graph.schema';

@Schema({ _id: false })
export class FlowTriggerConfig {
  @Prop({ required: false, type: String })
  kind?: string;

  @Prop({ required: false, type: Object })
  params?: Record<string, unknown>;
}

@Schema({ _id: false })
export class FlowSettings {
  @Prop({ required: true, type: Number, default: 25 })
  recursionLimit!: number;

  @Prop({ required: true, type: Number, default: 5 })
  maxParallelism!: number;
}

@Schema({ _id: false })
export class FlowNodePort {
  @Prop({ required: true, type: String })
  id!: string;

  @Prop({ required: false, type: String })
  label?: string;

  @Prop({ required: false, type: String })
  type?: string;

  @Prop({ required: false, type: Boolean, default: false })
  required?: boolean;
}

@Schema({ _id: false })
export class FlowNodeInput {
  @Prop({ required: false, type: String })
  raw?: string;

  @Prop({ required: false, type: [FlowNodePort] })
  ports?: FlowNodePort[];
}

@Schema({ _id: false })
export class FlowNodeOutput {
  @Prop({ required: false, type: String })
  raw?: string;

  @Prop({ required: false, type: [FlowNodePort] })
  ports?: FlowNodePort[];
}

@Schema({ _id: false })
export class RouterCondition {
  @Prop({ required: true, type: String })
  label!: string;

  @Prop({ required: false, type: String })
  sourceNode?: string;

  @Prop({ required: false, type: String })
  sourcePort?: string;

  @Prop({ required: false, type: String })
  path?: string;

  @Prop({ required: true, type: String, enum: ['equals', 'not_equals', 'contains', 'exists', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'] })
  operator!: string;

  @Prop({ required: false, type: Object })
  value?: unknown;
}

@Schema({ _id: false })
export class RouterConfig {
  @Prop({ required: true, type: [String] })
  outputLabels!: string[];

  @Prop({ required: true, type: Number, min: 1 })
  maxIterations!: number;

  @Prop({ required: false, type: [RouterCondition], default: [] })
  conditions?: RouterCondition[];

  @Prop({ required: false, type: String })
  defaultLabel?: string;
}

@Schema({ _id: false })
export class IteratorConfig {
  @Prop({ required: true, type: String })
  collectionPath!: string;

  @Prop({ required: false, type: Number })
  maxItems?: number;
}

@Schema({ _id: false })
export class HumanApprovalConfig {
  @Prop({ required: true, type: String })
  promptTemplate!: string;

  @Prop({ required: false, type: Number })
  timeoutSeconds?: number;
}

@Schema({ _id: false })
export class RetryPolicy {
  @Prop({ required: true, type: Number, default: 1 })
  maxRetries!: number;

  @Prop({ required: false, type: Number, default: 1000 })
  delayMs?: number;
}

@Schema({ _id: false })
export class FlowNode {
  @Prop({ required: true, type: String })
  id!: string;

  @Prop({ required: true, type: String, enum: ['step', 'router', 'iterator', 'human_approval'] })
  kind!: string;

  @Prop({ required: false, type: String })
  label?: string;

  @Prop({ required: false, type: String })
  description?: string;

  @Prop({ required: false, type: String })
  taskTemplateId?: string;

  @Prop({ required: false, type: String })
  promptTemplateId?: string;

  @Prop({ required: false, type: String })
  outputFormatId?: string;

  @Prop({ required: false, type: FlowNodeInput })
  input?: FlowNodeInput;

  @Prop({ required: false, type: FlowNodeOutput })
  output?: FlowNodeOutput;

  @Prop({ required: false, type: RouterConfig })
  routerConfig?: RouterConfig;

  @Prop({ required: false, type: IteratorConfig })
  iteratorConfig?: IteratorConfig;

  @Prop({ required: false, type: HumanApprovalConfig })
  humanApprovalConfig?: HumanApprovalConfig;

  @Prop({ required: false, type: RetryPolicy })
  retryPolicy?: RetryPolicy;

  @Prop({ required: false, type: HitlPolicy })
  hitlPolicy?: HitlPolicy;

  @Prop({ required: false, type: String })
  modelId?: string;

  @Prop({ required: false, type: Object })
  metadata?: Record<string, unknown>;

  @Prop({ required: false, type: Boolean, default: false })
  deepSearch?: boolean;
}

@Schema({ timestamps: true })
export class Flow {
  @Prop({ required: true, type: String })
  ownerId!: string;

  @Prop({ required: true, type: Number, default: 1 })
  schemaVersion!: number;

  @Prop({ required: true, type: Number, default: 0 })
  definitionRevision!: number;

  @Prop({ required: true, type: String, minlength: 2, maxlength: 100 })
  name!: string;

  @Prop({ required: false, type: String, maxlength: 20000 })
  description?: string;

  @Prop({ required: false, type: FlowTriggerConfig })
  triggerConfig?: FlowTriggerConfig;

  @Prop({ required: true, type: FlowSettings, default: () => ({ recursionLimit: 25, maxParallelism: 5 }) })
  settings!: FlowSettings;

  @Prop({ required: true, type: HitlPolicy, default: () => ({ ...DEFAULT_HITL_POLICY }) })
  hitlPolicy!: HitlPolicy;

  @Prop({ required: true, type: [HitlBlockerRule], default: [] })
  hitlBlockers!: HitlBlockerRule[];

  @Prop({ required: true, type: [FlowNode], default: [] })
  nodes!: FlowNode[];

  @Prop({ required: true, type: [ControlEdge], default: [] })
  controlEdges!: ControlEdge[];

  @Prop({ required: true, type: [DataBinding], default: [] })
  dataBindings!: DataBinding[];

  @Prop({ required: false, type: [String], default: [] })
  workspaces!: string[];

  @Prop({
    required: false,
    type: Object,
    default: () => ({
      inferenceModelId: null,
      nodeSuggestionsMode: 'inherit',
      approvalSuggestionMode: 'inherit',
    }),
  })
  designSettings?: Record<string, unknown>;

  @Prop({ required: false, type: Boolean, default: false })
  isFavorite?: boolean;

  @Prop({ required: false, type: Boolean, default: false })
  reflectionEnabled?: boolean;

  @Prop({ required: false, type: String, enum: ADVISOR_SCORING_MODES, default: 'llm' })
  advisorScoringMode?: AdvisorScoringMode;

  @Prop({ required: false, type: Boolean, default: false })
  advisorAutopilotEnabled?: boolean;

  @Prop({ required: false, type: Number })
  advisorAutopilotTargetScore?: number;

  @Prop({ required: false, type: Number })
  advisorAutopilotMaxTurns?: number;
}

export const FlowSchema = SchemaFactory.createForClass(Flow);

FlowSchema.index({ ownerId: 1, updatedAt: -1 });
FlowSchema.index({ ownerId: 1, name: 1 }, { unique: true });
FlowSchema.index({ 'nodes.metadata.toolBindings.connectorId': 1 });

FlowSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
