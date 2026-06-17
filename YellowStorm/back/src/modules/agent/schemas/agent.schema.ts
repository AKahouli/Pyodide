import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type AgentDocument = HydratedDocument<Agent>;

@Schema({ _id: false })
export class AgentConnectorActionSelection {
  @Prop({ type: Types.ObjectId, ref: 'Connector', required: true })
  connector!: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  actionKeys!: string[];
}

const AgentConnectorActionSelectionSchema = SchemaFactory.createForClass(AgentConnectorActionSelection);

function deriveAgentSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

@Schema({
  timestamps: true,
  collection: 'agents',
})
export class Agent extends Document {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 50 })
  name!: string;

  @Prop({ trim: true, minlength: 1, maxlength: 100, default: function(this: Agent) { return deriveAgentSlug(this.name); } })
  slug!: string;

  @Prop({ type: Types.ObjectId, ref: 'AgentType', required: true, index: true })
  agentType!: Types.ObjectId;

  @Prop({ required: true, maxlength: 50000 })
  role!: string;

  @Prop({ default: '', maxlength: 1000 })
  description!: string;

  @Prop({ type: Number, default:0, min: 0, max: 1 })
  temperature!: number;

  @Prop({ type: String, maxlength: 100 })
  llmModel?: string;

  @Prop({ default: '', maxlength: 50000 })
  instruction!: string;

  @Prop({ default: false })
  ignorePrePrompt!: boolean;

  @Prop({ type: [Types.ObjectId], ref: 'Workspace', default: [] })
  knowledgeBases!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Tool', default: [] })
  tools!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Skill', default: [] })
  skills!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Skill', default: [] })
  disabledSkills!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Connector', default: [] })
  connectors!: Types.ObjectId[];

  @Prop({ type: [AgentConnectorActionSelectionSchema], default: [] })
  connectorActionSelections!: AgentConnectorActionSelection[];

  @Prop({ default: false, index: true })
  isDefault!: boolean;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ default: false })
  isDefaultForType!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  // ===== A2A publishing =====
  // Set once the agent is published over the A2A protocol. The API key itself is
  // never stored (it is returned once by the gRPC service); only non-secret
  // metadata is persisted so the UI knows whether to publish or rotate the key.
  @Prop({ default: false })
  a2aPublished!: boolean;

  @Prop({ type: String })
  a2aAgentId?: string;

  @Prop({ type: String })
  a2aAgentCardUrl?: string;

  @Prop({ type: String })
  a2aApiKeyHeader?: string;

  @Prop({ type: Date })
  a2aPublishedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AgentSchema = SchemaFactory.createForClass(Agent);

// Indexes
AgentSchema.index({ createdBy: 1, isActive: 1 });
AgentSchema.index({ isDefault: 1, isActive: 1 });
AgentSchema.index({ name: 1, createdBy: 1 }, { unique: true });
AgentSchema.index({ createdBy: 1, slug: 1 }, { unique: true, partialFilterExpression: { isDefault: false, slug: { $exists: true, $type: 'string', $ne: '' } } });
AgentSchema.index({ slug: 1, isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true, slug: { $exists: true, $type: 'string', $ne: '' } } });
AgentSchema.index({ agentType: 1, createdBy: 1, isDefaultForType: 1 });
AgentSchema.index({ agentType: 1, isDefault: 1, isDefaultForType: 1 });

// JSON transform
AgentSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
