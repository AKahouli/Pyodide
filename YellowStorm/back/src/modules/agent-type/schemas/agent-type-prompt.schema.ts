import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { AgentType } from './agent-type.schema';

export type AgentTypePromptDocument = HydratedDocument<AgentTypePrompt>;

@Schema({
  timestamps: true,
  collection: 'agent_type_prompts',
})
export class AgentTypePrompt extends Document {
  @Prop({ type: Types.ObjectId, ref: AgentType.name, required: true, index: true })
  agentType!: Types.ObjectId;

  @Prop({ required: true, index: true })
  modelId!: string;

  @Prop({ required: true, maxlength: 50000 })
  prompt!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AgentTypePromptSchema = SchemaFactory.createForClass(AgentTypePrompt);

// Compound unique index
AgentTypePromptSchema.index({ agentType: 1, modelId: 1 }, { unique: true });

// JSON transform
AgentTypePromptSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
