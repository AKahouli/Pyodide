import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type AgentDocument = HydratedDocument<Agent>;

@Schema({
  timestamps: true,
  collection: 'agents',
})
export class Agent extends Document {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 50 })
  name!: string;

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

  @Prop({ default: false, index: true })
  isDefault!: boolean;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ default: false })
  isDefaultForType!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AgentSchema = SchemaFactory.createForClass(Agent);

// Indexes
AgentSchema.index({ createdBy: 1, isActive: 1 });
AgentSchema.index({ isDefault: 1, isActive: 1 });
AgentSchema.index({ name: 1, createdBy: 1 }, { unique: true });
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
